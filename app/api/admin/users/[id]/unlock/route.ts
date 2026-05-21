// POST /api/admin/users/[id]/unlock
// Admin manually unlocks a user account (clears failed_login_count + locked_until).
// Use case: user locked out, can't wait 15 min — admin unlocks immediately.
// Required role: super_admin / org_admin / admin

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { canManageUser } from "@/lib/auth/role-guards";
import type { DbUser } from "@/lib/auth/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await ctx.params;

  const admin = adminClient();
  const { data: user, error: fetchErr } = await admin
    .from("users")
    .select("id, org_id, email, role, failed_login_count, locked_until")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (fetchErr || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!canManageUser(session.user.role, user.role as DbUser["role"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const wasLocked = !!user.locked_until && new Date(user.locked_until) > new Date();
  const previousCount = user.failed_login_count;

  const { error } = await admin
    .from("users")
    .update({
      failed_login_count: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", session.user.org_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "ADMIN_UNLOCK_USER",
    resourceType: "user",
    resourceId: id,
    diff: {
      old: { failed_login_count: previousCount, locked_until: user.locked_until, was_locked: wasLocked },
      new: { failed_login_count: 0, locked_until: null },
    },
  });

  return NextResponse.json({
    success: true,
    wasLocked,
    email: user.email,
  });
}
