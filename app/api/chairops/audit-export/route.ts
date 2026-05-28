// GET /api/audit-export?from=YYYY-MM-DD&to=YYYY-MM-DD&entity=CashCollection
// ADMIN-only. Streams CSV of audit log rows for compliance export.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLUMNS = [
  "id",
  "createdAt",
  "userId",
  "userEmail",
  "userName",
  "userRole",
  "action",
  "entity",
  "entityId",
  "oldValue",
  "newValue",
  "metadata",
] as const;

const PAGE_SIZE = 500;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (rankOf(session.user.role) < rankOf("ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const entity = url.searchParams.get("entity");

  const where: Record<string, unknown> = {};
  if (fromStr || toStr) {
    const range: { gte?: Date; lt?: Date } = {};
    if (fromStr) {
      const d = parseYmd(fromStr);
      if (!d) return NextResponse.json({ error: "bad-from" }, { status: 400 });
      range.gte = d;
    }
    if (toStr) {
      const d = parseYmd(toStr);
      if (!d) return NextResponse.json({ error: "bad-to" }, { status: 400 });
      // inclusive end-of-day
      range.lt = new Date(d.getTime() + 86_400_000);
    }
    where.createdAt = range;
  }
  if (entity) where.entity = entity;

  const filename = buildFilename(fromStr, toStr, entity);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(COLUMNS.join(",") + "\n"));

      // Page through audit logs deterministically by (createdAt asc, id asc).
      // Skip/take is fine here since this is an admin-only export and we cap at 200k rows.
      let skip = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const rows = await prisma.chairopsAuditLog.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip,
          take: PAGE_SIZE,
          include: {
            user: { select: { email: true, displayName: true, role: true } },
          },
        });
        if (rows.length === 0) break;
        for (const r of rows) {
          const cols = [
            r.id,
            r.createdAt.toISOString(),
            r.userId ?? "",
            r.user?.email ?? "",
            r.user?.displayName ?? "",
            r.user?.role ?? "",
            r.action,
            r.entity,
            r.entityId,
            jsonField(r.oldValue),
            jsonField(r.newValue),
            jsonField(r.metadata),
          ];
          controller.enqueue(enc.encode(cols.map(csvCell).join(",") + "\n"));
        }
        if (rows.length < PAGE_SIZE) break;
        skip += rows.length;
        // Soft cap to avoid runaway exports — 200k rows.
        if (skip > 200_000) break;
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Treat as Bangkok local midnight (+07:00) so range matches business day.
  const d = new Date(`${s}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function jsonField(v: unknown): string {
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function csvCell(v: unknown): string {
  // HIGH-004: escape formula prefix before quoting (Excel injection guard)
  let s = v == null ? "" : String(v);
  if (s === "") return "";
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function buildFilename(from: string | null, to: string | null, entity: string | null) {
  const parts = ["audit-log"];
  if (entity) parts.push(entity);
  if (from) parts.push(from);
  if (to) parts.push(to);
  return `${parts.join("_")}.csv`;
}
