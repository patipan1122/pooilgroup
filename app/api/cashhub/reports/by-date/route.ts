// Lightweight detail endpoint for popup-first drilldown
// feedback_popup_first_drilldown.md — กดเซลล์ heatmap แล้ว fetch ข้อมูล lazy
//
// GET /api/cashhub/reports/by-date?branchId=xxx&date=YYYY-MM-DD
// Returns: { data: { report } | null, branch: { code, name, business_type } }

import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { can } from "@/lib/auth/permissions";
import { canFillForBranch } from "@/lib/auth/branch-access";

export async function GET(req: NextRequest) {
  const gate = await cashHubApiGuard();
  if (gate.error) return gate.error;
  const session = gate.session;
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

  // ดึงทุกกะของวัน (อาจมี morning/midday/evening) แล้วรวมเป็น 1 record
  // เดิม .maybeSingle() error เมื่อมีหลาย row → popup โชว์ "ยังไม่กรอก"
  const [branchQ, reportsQ] = await Promise.all([
    admin
      .from("branches")
      .select("id, code, name, business_type, province")
      .eq("id", branchId)
      .eq("org_id", session.user.org_id)
      .maybeSingle(),
    admin
      .from("daily_reports")
      .select(
        "id, branch_id, report_date, shift, status, total_sales, qty1, qty1_unit, qty2, qty2_unit, cash, transfer, card, credit, shortage, rental_income, training_sessions, notes, submitted_at, approved_at, rejected_reason",
      )
      .eq("org_id", session.user.org_id)
      .eq("branch_id", branchId)
      .eq("report_date", date)
      .order("shift", { ascending: true }),
  ]);

  if (!branchQ.data) {
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }

  const reports = reportsQ.data ?? [];

  if (reports.length === 0) {
    return NextResponse.json({ branch: branchQ.data, report: null });
  }

  // Status priority: approved > submitted > rejected > draft
  const STATUS_RANK: Record<string, number> = {
    approved: 4,
    submitted: 3,
    rejected: 2,
    draft: 1,
  };
  const bestStatusRow = reports.reduce((best, r) =>
    (STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[best.status] ?? 0) ? r : best,
  );

  // รวมยอดทุกกะ
  const sum = (k: keyof typeof reports[number]) =>
    reports.reduce((s, r) => s + (Number(r[k] ?? 0) || 0), 0);

  const aggregated = {
    // เก็บ id สำหรับ approve/reject เฉพาะกรณีมีกะเดียว
    id: reports.length === 1 ? reports[0]!.id : null,
    shifts: reports.map((r) => r.shift),
    shiftCount: reports.length,
    status: bestStatusRow.status,
    total_sales: sum("total_sales"),
    cash: sum("cash"),
    transfer: sum("transfer"),
    card: sum("card"),
    credit: sum("credit"),
    shortage: sum("shortage"),
    // notes รวมจากทุกกะ (กรองว่าง)
    notes: reports
      .map((r) => r.notes)
      .filter((n) => n && String(n).trim().length > 0)
      .join("\n\n"),
    submitted_at: reports.find((r) => r.submitted_at)?.submitted_at ?? null,
    approved_at: bestStatusRow.approved_at ?? null,
    rejected_reason: bestStatusRow.rejected_reason ?? null,
  };

  return NextResponse.json({
    branch: branchQ.data,
    report: aggregated,
  });
}
