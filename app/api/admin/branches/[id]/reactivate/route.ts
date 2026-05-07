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

  const { data: target } = await admin
    .from("branches")
    .select("id, is_active")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.is_active) {
    return NextResponse.json({ error: "สาขานี้เปิดอยู่แล้ว" }, { status: 409 });
  }

  await admin
    .from("branches")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_BRANCH",
    resourceType: "branch",
    resourceId: id,
    diff: { new: { is_active: true, reactivated: true } },
  });

  return NextResponse.json({ success: true });
}
