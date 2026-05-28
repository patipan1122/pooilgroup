// CSV export for Reconcile v2 — streams the daily ledger as text/csv.
//
//   GET /chairops/reconcile/export            → org-level (all branches)
//   GET /chairops/reconcile/export?branchId=X → single branch
//
// Cells are formula-injection-safe (safeCsvCell). requireRole("OFFICE").
// DISPLAY ONLY · reuses the same ledger builder the screen uses.

import { requireRole } from "@/lib/chairops/auth/session";
import { getReconcileLedger } from "@/lib/chairops/queries/reconcile-v2";
import { csvRow } from "@/lib/chairops/utils/csv-safe";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireRole("OFFICE");
  const orgId = session.poolUser.org_id;

  const url = new URL(req.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;

  const ledger = await getReconcileLedger({ orgId, branchId, take: 365 });

  const header = csvRow([
    "date",
    "online",
    "cash",
    "coin",
    "cashTotal",
    "totalRev",
    "deposit",
    "diff",
    "cumDrift",
    "collected",
  ]);
  const body = ledger
    .map((d) =>
      csvRow([
        d.date,
        d.online,
        d.cash,
        d.coin,
        d.cashTotal,
        d.totalRev,
        d.deposit ?? "",
        d.collected ? d.diff : "",
        d.cumDrift,
        d.collected ? "yes" : "no",
      ]),
    )
    .join("");

  const filename = branchId
    ? `reconcile-${branchId}.csv`
    : "reconcile-all-branches.csv";

  return new Response("﻿" + header + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
