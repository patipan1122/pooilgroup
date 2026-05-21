// Missing Report Reason — Manager records why a branch did not submit
// Spec: CASHHUB §11.5

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { isAdmin } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  branchId: zUUID(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonType: z.enum(["sick", "holiday", "system", "waiting", "other"]),
  reasonText: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!isAdmin(session.user) && session.user.role !== "branch_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { branchId, reportDate, reasonType, reasonText } = parsed.data;
  const admin = adminClient();
  const { data: branch } = await admin
    .from("branches")
    .select("id, org_id")
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (!branch) {
    return NextResponse.json({ error: "ไม่พบสาขา" }, { status: 404 });
  }

  // branch_manager may only post reasons for branches they're assigned to.
  // Admin tier (super_admin/org_admin/admin) keeps org-wide reach.
  if (session.user.role === "branch_manager") {
    const { count } = await admin
      .from("user_branches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("branch_id", branchId)
      .eq("is_active", true);
    if (!count || count < 1) {
      return NextResponse.json(
        { error: "ไม่มีสิทธิ์บันทึกเหตุผลของสาขานี้" },
        { status: 403 },
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = admin.from("missing_report_reasons");
  const { error } = await builder.upsert(
    {
      id: crypto.randomUUID(),
      org_id: branch.org_id,
      branch_id: branchId,
      report_date: reportDate,
      reason_type: reasonType,
      reason_text: reasonText ?? null,
      reported_by: session.user.id,
    },
    { onConflict: "branch_id,report_date" },
  );
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json(
        { error: "ตาราง missing_report_reasons ยังไม่ถูกสร้าง — รัน migration ก่อน" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await audit({
    orgId: branch.org_id,
    userId: session.user.id,
    action: "UPDATE_BRANCH",
    resourceType: "missing_report_reason",
    resourceId: branchId,
    diff: { new: { reportDate, reasonType, reasonText } },
  });
  return NextResponse.json({ ok: true });
}
