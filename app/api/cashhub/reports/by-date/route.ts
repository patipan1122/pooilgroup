// Lightweight detail endpoint for popup-first drilldown
// feedback_popup_first_drilldown.md — กดเซลล์ heatmap แล้ว fetch ข้อมูล lazy
//
// GET /api/cashhub/reports/by-date?branchId=xxx&date=YYYY-MM-DD
// Returns: { data: { report } | null, branch: { code, name, business_type } }

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { can } from "@/lib/auth/permissions";
import { canFillForBranch } from "@/lib/auth/branch-access";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!can(session.user, "cashhub.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const date = searchParams.get("date");
  if (!branchId || !date) {
    return NextResponse.json(
      { error: "branchId and date required" },
      { status: 400 },
    );
  }

  // Branch managers / staff can only see own scope
  if (
    session.user.role === "branch_manager" ||
    session.user.role === "staff"
  ) {
    const allowed = await canFillForBranch(session.user, branchId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden — not your branch" },
        { status: 403 },
      );
    }
  }

  const admin = adminClient();

  const [branchQ, reportQ] = await Promise.all([
    admin
      .from("branches")
      .select("id, code, name, business_type, province")
      .eq("id", branchId)
      .eq("org_id", session.user.org_id)
      .maybeSingle(),
    admin
      .from("daily_reports")
      .select(
        "id, branch_id, report_date, shift, status, total_sales, qty1, qty1_unit, qty2, qty2_unit, cash, transfer, card, credit, shortage, rental_income, training_sessions, notes, submitted_at, approved_at, approved_by, rejected_reason, shortage_info, extra_fields",
      )
      .eq("org_id", session.user.org_id)
      .eq("branch_id", branchId)
      .eq("report_date", date)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!branchQ.data) {
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }

  return NextResponse.json({
    branch: branchQ.data,
    report: reportQ.data ?? null,
  });
}
