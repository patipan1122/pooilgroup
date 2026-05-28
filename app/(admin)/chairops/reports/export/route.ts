// CSV export · GET /reports/export?from=YYYY-MM-DD&to=YYYY-MM-DD&type=daily|monthly
// Streamed via Web Streams API to keep memory low for large date ranges
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";

export const dynamic = "force-dynamic";

const BOM = "﻿"; // Excel-compatible UTF-8 BOM for Thai chars

function csvEscape(v: unknown): string {
  // HIGH-004: escape formula prefix (Excel injection guard)
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cols: unknown[]): string {
  return cols.map(csvEscape).join(",") + "\n";
}

function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await requireRole("MANAGER");

  const { searchParams } = new URL(req.url);
  const defaultFrom = new Date();
  defaultFrom.setDate(1);
  const from = parseDate(searchParams.get("from"), defaultFrom);
  const to = parseDate(searchParams.get("to"), new Date());
  // Make `to` inclusive: bump to end of day
  to.setHours(23, 59, 59, 999);

  const type = (searchParams.get("type") ?? "daily") as "daily" | "monthly";

  const branches = await prisma.chairopsBranch.findMany({
    select: { id: true, name: true, slug: true, mallGroup: true },
  });
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  await writeAudit({
    userId: session.user.id,
    action: "reports.export",
    entity: "Report",
    entityId: type,
    metadata: { from: fmtDate(from), to: fmtDate(to), type },
  });

  if (type === "daily") {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(BOM));
        controller.enqueue(
          enc.encode(
            row([
              "วันที่",
              "สาขา",
              "ห้าง",
              "เก้าอี้",
              "Online",
              "แบงค์",
              "เหรียญ",
              "เงินสดรวม",
              "รวมทั้งหมด",
            ])
          )
        );

        // Stream in chunks of 500 rows
        type BatchRow = {
          id: string;
          branchId: string;
          chairCode: string | null;
          bizDate: Date;
          onlineTotal: { toString(): string };
          cashTotal: { toString(): string };
          coinInsertCount: number;
          totalCash: { toString(): string };
          grossTotal: { toString(): string };
        };
        const pageSize = 500;
        let cursor: string | undefined = undefined;
        while (true) {
          const batch: BatchRow[] = await prisma.chairopsPosDaily.findMany({
            where: { bizDate: { gte: from, lte: to } },
            orderBy: [{ bizDate: "asc" }, { id: "asc" }],
            take: pageSize,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            select: {
              id: true,
              branchId: true,
              chairCode: true,
              bizDate: true,
              onlineTotal: true,
              cashTotal: true,
              coinInsertCount: true,
              totalCash: true,
              grossTotal: true,
            },
          });
          if (batch.length === 0) break;
          for (const p of batch) {
            const b = branchMap.get(p.branchId);
            controller.enqueue(
              enc.encode(
                row([
                  fmtDate(p.bizDate),
                  b?.name ?? p.branchId,
                  b?.mallGroup ?? "",
                  p.chairCode ?? "(branch total)",
                  p.onlineTotal.toString(),
                  p.cashTotal.toString(),
                  p.coinInsertCount,
                  p.totalCash.toString(),
                  p.grossTotal.toString(),
                ])
              )
            );
          }
          if (batch.length < pageSize) break;
          cursor = batch[batch.length - 1].id;
        }
        controller.close();
      },
    });
    const fname = `chairops-pos-daily-${fmtDate(from)}-to-${fmtDate(to)}.csv`;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  }

  // type === "monthly" — small enough to build in-memory (1 row per branch per month)
  const [posDaily, collections, writeOffs] = await Promise.all([
    prisma.chairopsPosDaily.findMany({
      where: { bizDate: { gte: from, lte: to } },
      select: { branchId: true, bizDate: true, grossTotal: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: { collectedAt: { gte: from, lte: to } },
      select: { branchId: true, collectedAt: true, depositedAmount: true },
    }),
    prisma.chairopsWriteOff.findMany({
      where: { makerAt: { gte: from, lte: to }, status: "APPROVED" },
      select: { branchId: true, makerAt: true, amount: true },
    }),
  ]);

  type Cell = { pos: number; dep: number; wo: number };
  const matrix = new Map<string, Cell>();
  const keyFor = (bid: string, d: Date) => {
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${bid}__${ym}`;
  };
  const ensure = (k: string) => {
    if (!matrix.has(k)) matrix.set(k, { pos: 0, dep: 0, wo: 0 });
    return matrix.get(k)!;
  };
  // grossTotal is Decimal — coerce to number for summation
  for (const p of posDaily) ensure(keyFor(p.branchId, p.bizDate)).pos += Number(p.grossTotal);
  for (const c of collections) ensure(keyFor(c.branchId, c.collectedAt)).dep += c.depositedAmount;
  for (const w of writeOffs) ensure(keyFor(w.branchId, w.makerAt)).wo += w.amount;

  // Sort by branchName, month
  const out: string[] = [];
  out.push(BOM);
  out.push(row(["เดือน", "สาขา", "ห้าง", "POS", "ฝาก", "Write-off", "ส่วนต่าง"]));
  const sortedKeys = [...matrix.keys()].sort();
  for (const k of sortedKeys) {
    const [bid, ym] = k.split("__");
    const b = branchMap.get(bid);
    const cell = matrix.get(k)!;
    const drift = cell.pos - cell.dep - cell.wo;
    out.push(
      row([ym, b?.name ?? bid, b?.mallGroup ?? "", cell.pos, cell.dep, cell.wo, drift])
    );
  }
  const fname = `chairops-monthly-${fmtDate(from)}-to-${fmtDate(to)}.csv`;
  return new Response(out.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
