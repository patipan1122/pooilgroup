// POST /api/admin/users/[id]/force-logout
// Revoke all active sessions of a user (kick them out from all devices).
// Use case: user lost phone, security incident, role change.
//
// Mechanics:
//   1. Mark all rows in user_sessions as is_revoked=true (so our middleware blocks).
//   2. Call Supabase Auth admin signOut to invalidate refresh tokens (best effort).

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await ctx.params;
  const admin = adminClient();

  // Confirm target user belongs to same org
  const { data: target } = await admin
    .from("users")
    .select("id, org_id, name, role")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cannot force logout super_admin (Owner protection — only Owner can do that themselves)
  if (target.role === "super_admin" && target.id !== session.user.id) {
    return NextResponse.json(
      { error: "ไม่สามารถ Force Logout Super Admin คนอื่นได้" },
      { status: 403 },
    );
  }

  // Mark all sessions revoked
  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("user_sessions")
    .update({ is_revoked: true, logout_at: now })
    .eq("user_id", id)
    .eq("is_revoked", false);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Best-effort: invalidate Supabase Auth refresh tokens
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.auth.admin as any).signOut(id);
  } catch {
    // ignore — admin signOut may not always succeed; sessions table is the gate
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DEACTIVATE_USER",
    resourceType: "user",
    resourceId: id,
    diff: { new: { force_logout: true, reason: "admin_action" } },
  });

  return NextResponse.json({ success: true });
}
