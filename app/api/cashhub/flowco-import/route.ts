// POST /api/cashhub/flowco-import — commit: read FlowCo fuel sales for a date range and
// upsert them into daily_reports (per mapped branch/day). Idempotent (onConflict).

import { NextRequest, NextResponse } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  computeFlowcoPlan,
  commitFlowcoPlan,
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
    const { created, updated } = await commitFlowcoPlan(admin, plan);

    await audit({
      orgId,
      userId: session.user.id,
      action: "BULK_IMPORT_FLOWCO_REPORTS",
      resourceType: "daily_report",
      diff: {
        new: {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          created,
          updated,
          same: plan.summary.same,
          unmappedDays: plan.summary.unmappedDays,
          reconFlags: plan.reconFlags,
          baht: plan.summary.baht,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      created,
      updated,
      same: plan.summary.same,
      total: plan.summary.total,
      unmappedDays: plan.summary.unmappedDays,
      unmapped: plan.unmapped,
      reconFlags: plan.reconFlags,
      baht: plan.summary.baht,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
