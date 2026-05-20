// PATCH /api/bugs/[id] — update bug status / admin note (admin tier only)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { isAdminTier } from "@/lib/auth/role-guards";

const PatchSchema = z.object({
  status: z.enum(["new", "acked", "fixed", "closed"]).optional(),
  adminNote: z.string().max(2000).optional(),
  fixedCommitSha: z.string().max(40).optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const idCheck = zUUID().safeParse(id);
  if (!idCheck.success) {
    return NextResponse.json({ error: "Invalid bug id" }, { status: 400 });
  }

  const meta = getRequestMeta(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const admin = adminClient();
  // Verify bug exists in this org
  const { data: existing } = await admin
    .from("bug_reports")
    .select("id, status, admin_note")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "ไม่พบ bug นี้" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (parsed.data.status) {
    updates.status = parsed.data.status;
    // Transition timestamps
    if (parsed.data.status === "acked") {
      updates.acknowledged_by_id = session.user.id;
      updates.acknowledged_at = now;
    } else if (parsed.data.status === "fixed") {
      updates.fixed_at = now;
      if (parsed.data.fixedCommitSha) {
        updates.fixed_commit_sha = parsed.data.fixedCommitSha;
      }
    }
  }
  if (parsed.data.adminNote !== undefined) {
    updates.admin_note = parsed.data.adminNote;
  }

  const { error } = await admin
    .from("bug_reports")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("[PATCH /bugs] error", error);
    return NextResponse.json({ error: "อัปเดตไม่สำเร็จ" }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER", // reuse existing AuditAction enum value
    resourceType: "bug_report",
    resourceId: id,
    diff: {
      old: { status: existing.status, admin_note: existing.admin_note },
      new: { status: parsed.data.status, admin_note: parsed.data.adminNote },
    },
    ...meta,
  });

  return NextResponse.json({ ok: true });
}
