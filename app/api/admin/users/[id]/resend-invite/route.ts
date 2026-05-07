// Generate a new invite token for a pending user (is_active=false, invite not used)
// Use case: original link expired or got lost.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await ctx.params;
  const admin = adminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, org_id, is_active, invite_used_at")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.is_active || target.invite_used_at) {
    return NextResponse.json(
      { error: "ผู้ใช้นี้ activate แล้ว ใช้ Reset Password แทน" },
      { status: 409 },
    );
  }

  const token = makeToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await admin
    .from("users")
    .update({
      invite_token: token,
      invite_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "user",
    resourceId: id,
    diff: { new: { resent_invite: true, expires_at: expiresAt } },
  });

  return NextResponse.json({
    success: true,
    inviteUrl: `${getRequestBaseUrl(req)}/invite/${token}`,
    expiresAt,
  });
}
