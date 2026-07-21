// Pinpoint — mark a session's pins as fixed (closes the loop).
//   POST /api/pinpoint/sessions/[id]/mark-fixed
//
// Two callers:
//   • "พิม" (the developer/Claude) after fixing + pushing — auth via CRON_SECRET
//     bearer, no browser login needed. This is the "automatic" path: the CEO
//     opens the review page and sees pins already flipped to "แก้แล้ว" + commit.
//   • super_admin in the UI — auth via session.
//
// Body: { commitSha?: string, pinIds?: string[], status?: "fixed" | "open" }
//   pinIds omitted → applies to ALL pins in the session.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { getSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { pinpointV1 } from "@/lib/pinpoint/flags";
import { verifyServiceSecret } from "@/lib/pinpoint/service-auth";

export const runtime = "nodejs";

const BodySchema = z.object({
  commitSha: z.string().max(64).optional(),
  pinIds: z.array(zUUID()).max(500).optional(),
  status: z.enum(["fixed", "open"]).default("fixed"),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!zUUID().safeParse(id).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }

  // Authorize: service secret (no login) OR super_admin session.
  let orgScope: string | null = null; // null = service (trusted, any org)
  if (!verifyServiceSecret(req)) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ต้อง login" }, { status: 401 });
    }
    if (!isSuperAdmin(session.user.role)) {
      return NextResponse.json({ error: "เฉพาะ super_admin" }, { status: 403 });
    }
    orgScope = session.user.org_id;
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { commitSha, pinIds, status } = parsed.data;

  const admin = adminClient();

  // Confirm the session exists (and is in-org when called by a super_admin).
  let sessQ = admin
    .from("pinpoint_sessions")
    .select("id, org_id")
    .eq("id", id);
  if (orgScope) sessQ = sessQ.eq("org_id", orgScope);
  const { data: sess } = await sessQ.maybeSingle();
  if (!sess) {
    return NextResponse.json({ error: "ไม่พบ session" }, { status: 404 });
  }
  const sessionOrgId = (sess as { org_id: string }).org_id;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status,
    fixed_at: status === "fixed" ? now : null,
    updated_at: now,
  };
  if (commitSha !== undefined) updates.fixed_commit_sha = commitSha;

  let upd = admin
    .from("pinpoint_pins")
    .update(updates, { count: "exact" })
    .eq("session_id", id)
    .eq("org_id", sessionOrgId);
  if (pinIds && pinIds.length > 0) upd = upd.in("id", pinIds);

  const { error, count } = await upd.select("id");
  if (error) {
    console.error("[pinpoint mark-fixed]", error);
    return NextResponse.json({ error: "อัปเดตไม่สำเร็จ" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: count ?? 0, status });
}
