// Unlock approved report — Super Admin only (CASHHUB §4 Rule 4)
// Reverts an approved report back to "submitted" with audit + reason

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { sendNotification } from "@/lib/notifications/send";

const Schema = z.object({
  reportId: z.string().uuid(),
  reason: z.string().min(5).max(500),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร" }, { status: 400 });
  }
  const { reportId, reason } = parsed.data;
  const admin = adminClient();

  const { data: report } = await admin
    .from("daily_reports")
    .select("id, org_id, branch_id, status, submitted_by_id, branches(code)")
    .eq("id", reportId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "ไม่พบรายงาน" }, { status: 404 });
  if (report.status !== "approved") {
    return NextResponse.json(
      { error: "Unlock ได้เฉพาะรายงานที่อนุมัติแล้วเท่านั้น" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  await admin
    .from("daily_reports")
    .update({
      status: "submitted",
      approved_by_id: null,
      approved_at: null,
      unlock_by_id: session.user.id,
      unlock_reason: reason,
      unlock_at: now,
      updated_at: now,
    })
    .eq("id", reportId);

  await audit({
    orgId: report.org_id,
    userId: session.user.id,
    action: "UNLOCK_REPORT",
    resourceType: "daily_report",
    resourceId: reportId,
    diff: { old: { status: "approved" }, new: { status: "submitted", reason } },
  });

  const branchRel = Array.isArray(report.branches)
    ? report.branches[0]
    : report.branches;
  const branchCode = (branchRel as { code?: string } | null)?.code ?? "—";
  if (report.submitted_by_id) {
    await sendNotification({
      orgId: report.org_id,
      userId: report.submitted_by_id,
      type: "warning",
      module: "cashhub",
      title: `🔓 รายงาน ${branchCode} ถูกปลดล็อก`,
      body: `เหตุผล: ${reason} — กรอกใหม่ได้แล้ว`,
      link: `/cashhub/reports/${reportId}`,
    });
  }

  return NextResponse.json({ ok: true });
}
