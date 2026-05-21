// ClawFleet — CSV export endpoint
// Echoes report events as CSV with formula-injection protection
// (per memory pool-csv-import-must-diff-before-write style guards)

import type { NextRequest } from "next/server";
import { getReportEvents } from "@/lib/clawfleet/queries";
import { requireSession } from "@/lib/auth/session";

export const runtime = "nodejs";

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // prevent formula injection
  if (/^[=+\-@\t\r]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  await requireSession();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(Date.now() - 7 * 86400000);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
  const branchId = url.searchParams.get("branch") ?? undefined;
  // P1-14 fix: getReportEvents now scope-intersects branchId — no extra check needed
  // because it returns empty if user can't access the branch.
  const events = await getReportEvents({ from, to, branchId });

  const headers = [
    "เวลา",
    "Session",
    "สาขา",
    "ตู้",
    "ประเภทตู้",
    "พนักงาน",
    "Coin Before",
    "Coin After",
    "Coin Δ",
    "Cash (THB)",
    "Doll Before",
    "Doll After",
    "Stock Before",
    "Refill",
    "Stock After",
    "Anomaly Flags",
    "Notes",
  ];
  const rows = events.map((e) => [
    new Date(e.collectedAt).toISOString(),
    e.session?.sessionCode ?? "",
    e.machine.branch.name,
    e.machine.code,
    e.machine.kind,
    e.collectedBy.name,
    e.coinMeterBefore,
    e.coinMeterAfter,
    e.coinMeterAfter - e.coinMeterBefore,
    (e.cashCountedCents / 100).toFixed(2),
    e.dollMeterBefore ?? "",
    e.dollMeterAfter ?? "",
    e.stockBefore ?? "",
    e.refillQty ?? "",
    e.stockAfter ?? "",
    e.anomalyFlags.join("|"),
    e.notes ?? "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
  const filename = `clawfleet-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`
    .replace(/[^a-zA-Z0-9\-.]/g, "_");

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
