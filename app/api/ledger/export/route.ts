// GET /api/ledger/export?company=<uuid>&period=YYYY-MM
//
// Browser-friendly CSV download of CONFIRMED+LOCKED expenses for a company/period
// (feeds TRCloud). This is a thin wrapper over the audited server action
// `exportConfirmedCsv` (app/(admin)/ledger/_actions.ts) — all the security
// (session + module entitlement + accountant-tier + org/company scoping + batch
// log + audit row) lives there. We only translate its result into an HTTP file
// response so a plain <a download> can trigger the save dialog.
//
// NEVER exports drafts (the action filters to confirmed/locked only).

import { NextRequest, NextResponse } from "next/server";
import { exportConfirmedCsv } from "@/app/(admin)/ledger/_actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company") ?? "";
  const period = searchParams.get("period") ?? "";

  const res = await exportConfirmedCsv({ companyId, period });
  if (!res.ok) {
    // 400 for validation/scope errors; the action already maps auth failures to
    // a Thai message string. Keep it simple — the UI surfaces res.error text.
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  // The action's CSV already carries a single UTF-8 BOM (buildTrcloudCsv
  // defaults bom:true) so Excel opens Thai text correctly. Do NOT prepend
  // another BOM here — a double BOM corrupts the first header cell and can
  // break a strict TRCloud importer.
  return new NextResponse(res.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${res.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
