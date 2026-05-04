// Reactivate a previously-deactivated user.
// Doesn't re-enable Supabase auth password — user must be invited again
// (in case password was rotated by IT).

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await ctx.params;
  const admin = adminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, org_id, is_active")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.is_active) {
    return NextResponse.json(
      { error: "บัญชีนี้ใช้งานอยู่แล้ว" },
      { status: 409 },
    );
  }

  await admin
    .from("users")
    .update({
      is_active: true,
      failed_login_count: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "user",
    resourceId: id,
    diff: { new: { is_active: true, reactivated: true } },
  });

  return NextResponse.json({ success: true });
}
