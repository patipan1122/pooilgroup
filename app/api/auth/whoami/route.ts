// Diagnostic — does the current request have a readable Supabase session?
// Called from /auth/liff-complete right after the server-side setSession POST
// to confirm the cookie actually landed in the browser's cookie jar AND is
// readable on a fresh request (catches the iOS-WKWebView partitioning case
// where setSession queues cookies but the next request doesn't carry them).
//
// Returns:
//   { authenticated: true, authUserId, hasPoolUser, hasChairopsUser } on hit
//   { authenticated: false, reason } on miss

import { type NextRequest, NextResponse } from "next/server";
import { serverClient, adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const sb = await serverClient();
  const { data: u, error } = await sb.auth.getUser();
  if (error || !u?.user) {
    return NextResponse.json({
      authenticated: false,
      reason: error?.message ?? "no-auth-user",
    });
  }
  const authUserId = u.user.id;
  const admin = adminClient();
  const { data: poolRow } = await admin
    .from("users")
    .select("id, role, is_active, org_id")
    .eq("id", authUserId)
    .maybeSingle();
  const chairUser = await prisma.chairopsUser
    .findFirst({
      where: { authUserId, isActive: true },
      select: { id: true, role: true, orgId: true, primaryBranchId: true },
    })
    .catch(() => null);
  return NextResponse.json({
    authenticated: true,
    authUserId,
    email: u.user.email ?? null,
    hasPoolUser: !!poolRow,
    poolUserActive: !!poolRow?.is_active,
    poolRole: poolRow?.role ?? null,
    hasChairopsUser: !!chairUser,
    chairopsRole: chairUser?.role ?? null,
    branchAssigned: !!chairUser?.primaryBranchId,
  });
}
