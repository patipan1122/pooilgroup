// POST /api/admin/users/[id]/impersonate
// Admin starts impersonating target user. Sets a signed cookie that
// session.ts honors to swap the surface user. Real auth session stays intact —
// "return to self" just clears the cookie.
//
// Restrictions:
// - Caller must be super_admin / org_admin / admin (real role, not impersonated).
//   2026-05-30: relaxed from super_admin-only so ChairOps office can play-as
//   any maid (CEO wants to test maid flow or do a maid's cash-collect run
//   themselves on the rare day a maid is off).
// - Cannot impersonate self.
// - Target must be in same org and active.

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireRealRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  IMPERSONATION_COOKIE,
  encodeImpersonationCookie,
} from "@/lib/auth/impersonation";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRealRole("super_admin", "org_admin", "admin");
  const realAdminId = session.actingAs
    ? session.actingAs.realUser.id
    : session.user.id;
  const { id: targetId } = await ctx.params;

  if (targetId === realAdminId) {
    return NextResponse.json(
      { error: "ไม่สามารถเข้าใช้แทนตัวเองได้" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, org_id, name, role, is_active")
    .eq("id", targetId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target || !target.is_active) {
    return NextResponse.json(
      { error: "ผู้ใช้ไม่พร้อมใช้งาน" },
      { status: 404 },
    );
  }

  const cookieValue = encodeImpersonationCookie(realAdminId, targetId);
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  await audit({
    orgId: session.user.org_id,
    userId: realAdminId,
    action: "IMPERSONATE_START",
    resourceType: "user",
    resourceId: targetId,
    diff: { new: { target_name: target.name, target_role: target.role } },
  });

  return NextResponse.json({ success: true });
}
