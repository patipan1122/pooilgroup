// POST /api/cashhub/flowco-import/preview — dry-run: read FlowCo fuel sales for a date
// range, classify vs existing daily_reports, return counts. No writes.

import { NextRequest, NextResponse } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import {
  computeFlowcoPlan,
  normalizeDateRange,
} from "@/lib/cashhub/flowco-import-core";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const { session } = gate;
  const orgId = session.user.org_id;

  let body: { dateFrom?: string; dateTo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const range = normalizeDateRange(body.dateFrom, body.dateTo);
  if (!range) {
    return NextResponse.json({ error: "ช่วงวันที่ไม่ถูกต้อง" }, { status: 400 });
  }

  const admin = adminClient();
  try {
    const plan = await computeFlowcoPlan(
      admin,
      orgId,
      session.user.id,
      range.dateFrom,
      range.dateTo,
    );
    return NextResponse.json({
      ok: true,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      summary: plan.summary,
      reconFlags: plan.reconFlags,
      unmapped: plan.unmapped,
      excluded: plan.excluded,
      changedSample: plan.rows
        .filter((r) => r.status === "changed")
        .slice(0, 15)
        .map((r) => ({
          branchName: r.branchName,
          reportDate: r.reportDate,
          old: r.oldTotal,
          new: r.totalSales,
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
