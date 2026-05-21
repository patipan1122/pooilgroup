// Unlock approved report — Super Admin only (CASHHUB §4 Rule 4)
// Reverts an approved report back to "submitted" with audit + reason

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { sendNotification } from "@/lib/notifications/send";

const Schema = z.object({
  reportId: zUUID(),
  reason: z.string().min(5).max(500),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin");
  const meta = getRequestMeta(req);
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
    .select(
      "id, org_id, branch_id, status, submitted_by_id, approved_by_id, approved_at, branches(code)",
    )
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

  // SoD enforcement (CEO 2026-05-20 "อนุมัติเองบ่อยไป")
  // super_admin ห้าม unlock report ที่ตัวเองเป็นทั้งคนกรอกหรือคนอนุมัติ
  // ต้องให้ super_admin คนอื่นเป็นคนปลดล็อก
  const isSelfApprover = report.approved_by_id === session.user.id;
  const isSelfSubmitter = report.submitted_by_id === session.user.id;
  if (isSelfApprover || isSelfSubmitter) {
    await audit({
      orgId: report.org_id,
      userId: session.user.id,
      action: "PERMISSION_DENIED",
      resourceType: "daily_report",
      resourceId: reportId,
      diff: {
        new: {
          attempted: "self_unlock",
          reason: "SoD violation",
          isSelfApprover,
          isSelfSubmitter,
        },
      },
      ...meta,
    });
    return NextResponse.json(
      {
        error:
          "คุณเป็นผู้กรอกหรืออนุมัติรายงานนี้เอง · ต้องให้ Super Admin คนอื่นเป็นคนปลดล็อก (Segregation of Duties)",
      },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  // Atomic guard: only flip from approved → submitted. If another admin
  // already unlocked between our read and write, this returns 0 rows and
  // we report a friendly conflict instead of silently clobbering their
  // unlock_by_id/at (which would lose audit trail).
  const { data: updated, error: updateError } = await admin
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
    .eq("id", reportId)
    .eq("status", "approved")
    .select("id");

  if (updateError) {
    console.error("[POST /cashhub/unlock]", updateError);
    return NextResponse.json(
      { error: "ปลดล็อกไม่สำเร็จ ลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      {
        error:
          "รายงานนี้ถูก unlock โดยคนอื่นไปแล้ว หรือสถานะเปลี่ยน · รีเฟรชหน้าและลองใหม่",
      },
      { status: 409 },
    );
  }

  // Snapshot the original approver before unlock blew them away (Finance audit · 2026-05-20)
  // Without this, "ใครอนุมัติยอดเดิม" จะหายไปจาก current row state.
  await audit({
    orgId: report.org_id,
    userId: session.user.id,
    action: "UNLOCK_REPORT",
    resourceType: "daily_report",
    resourceId: reportId,
    diff: {
      old: {
        status: "approved",
        approved_by_id: report.approved_by_id,
        approved_at: report.approved_at,
      },
      new: { status: "submitted", reason },
    },
    ...meta,
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
