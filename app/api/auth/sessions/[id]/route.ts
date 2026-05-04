// Revoke a specific session (Force Logout that device).
// User can revoke own sessions; admin can revoke any session in org.

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { isAdmin } from "@/lib/auth/permissions";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id: sessionId } = await ctx.params;
  const admin = adminClient();

  // Fetch session to check ownership
  const { data: target } = await admin
    .from("user_sessions")
    .select("id, org_id, user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const isOwner = target.user_id === session.user.id;
  const sameOrg = target.org_id === session.user.org_id;

  if (!isOwner && !(isAdmin(session.user) && sameOrg)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  await admin
    .from("user_sessions")
    .update({ is_revoked: true, logout_at: now })
    .eq("id", sessionId);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LOGOUT",
    resourceType: "user_session",
    resourceId: sessionId,
    diff: {
      new: { revoked_by: session.user.id, target_user_id: target.user_id },
    },
  });

  return NextResponse.json({ success: true });
}
