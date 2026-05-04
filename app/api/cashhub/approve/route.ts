import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { canApproveBranch } from "@/lib/auth/permissions";

const ApproveSchema = z.object({
  reportId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const { reportId, action, reason } = parsed.data;
  const admin = adminClient();

  const { data: report } = await admin
    .from("daily_reports")
    .select("id, org_id, branch_id, status")
    .eq("id", reportId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ error: "ไม่พบรายงาน" }, { status: 404 });
  }

  if (report.status === "approved") {
    return NextResponse.json(
      { error: "รายงานนี้ถูกอนุมัติแล้ว ติดต่อ Super Admin หากต้องแก้" },
      { status: 409 },
    );
  }

  // Check approver permission for this specific branch
  const { data: ub } = await admin
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", session.user.id)
    .eq("is_active", true);
  const userBranchIds = ub?.map((u) => u.branch_id as string) ?? [];

  if (!canApproveBranch(session.user, report.branch_id, userBranchIds)) {
    await audit({
      orgId: report.org_id,
      userId: session.user.id,
      action: "PERMISSION_DENIED",
      resourceType: "daily_report",
      resourceId: reportId,
      diff: { new: { attempted: action } },
    });
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์อนุมัติสาขานี้" },
      { status: 403 },
    );
  }

  const updates: Record<string, unknown> =
    action === "approve"
      ? {
          status: "approved",
          approved_by_id: session.user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : {
          status: "rejected",
          rejected_reason: reason ?? "ไม่ระบุเหตุผล",
          updated_at: new Date().toISOString(),
        };

  const { error } = await admin
    .from("daily_reports")
    .update(updates)
    .eq("id", reportId);

  if (error) {
    console.error("[POST /cashhub/approve]", error);
    return NextResponse.json({ error: "อัปเดตไม่ได้ ลองใหม่" }, { status: 500 });
  }

  await audit({
    orgId: report.org_id,
    userId: session.user.id,
    action: action === "approve" ? "APPROVE_REPORT" : "REJECT_REPORT",
    resourceType: "daily_report",
    resourceId: reportId,
    diff: {
      old: { status: report.status },
      new: { status: action === "approve" ? "approved" : "rejected", reason },
    },
  });

  return NextResponse.json({ success: true });
}
