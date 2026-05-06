// POST /api/admin/users/return-to-self
// Clears the impersonation cookie and audits the exit. The real auth session
// is unchanged — admin keeps browsing as themselves.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation";

export async function POST() {
  const session = await requireSession();
  if (!session.actingAs) {
    return NextResponse.json({ success: true });
  }

  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE);

  await audit({
    orgId: session.actingAs.realUser.org_id,
    userId: session.actingAs.realUser.id,
    action: "IMPERSONATE_END",
    resourceType: "user",
    resourceId: session.user.id,
    diff: { new: { target_name: session.user.name } },
  });

  return NextResponse.json({ success: true });
}
