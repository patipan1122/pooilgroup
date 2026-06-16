// Pinpoint — single pin
//   PATCH  /api/pinpoint/pins/[pinId]  : edit comment/priority, attach screenshot,
//                                        or set fix status (super_admin)
//   DELETE /api/pinpoint/pins/[pinId]  : remove a pin (owner or super_admin)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { deleteObject } from "@/lib/r2/upload";
import { pinpointV1 } from "@/lib/pinpoint/flags";

const PatchSchema = z.object({
  comment: z.string().max(2000).optional(),
  priority: z.enum(["urgent", "normal"]).optional(),
  status: z.enum(["open", "fixed", "wontfix"]).optional(),
  screenshotKey: z.string().max(500).optional().nullable(),
  fixedCommitSha: z.string().max(40).optional(),
});

/** Load a pin with its owning session's author for permission checks. */
async function loadPin(orgId: string, pinId: string) {
  const admin = adminClient();
  const { data } = await admin
    .from("pinpoint_pins")
    .select(
      "id, session_id, screenshot_key, session:session_id(author_id, status)",
    )
    .eq("id", pinId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data as
    | {
        id: string;
        session_id: string;
        screenshot_key: string | null;
        session: { author_id: string; status: string } | null;
      }
    | null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ pinId: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  const { pinId } = await ctx.params;
  if (!zUUID().safeParse(pinId).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const d = parsed.data;
  const orgId = session.user.org_id;
  const pin = await loadPin(orgId, pinId);
  if (!pin) return NextResponse.json({ error: "ไม่พบจุด" }, { status: 404 });

  const isOwner = pin.session?.author_id === session.user.id;
  const sa = isSuperAdmin(session.user.role);

  // Fix-status is a reviewer action (super_admin); content edits are owner/super_admin.
  if ((d.status || d.fixedCommitSha) && !sa) {
    return NextResponse.json({ error: "เฉพาะ super_admin" }, { status: 403 });
  }
  if (!isOwner && !sa) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }
  if (d.screenshotKey && !d.screenshotKey.startsWith(`users/${session.user.id}/`)) {
    return NextResponse.json({ error: "screenshotKey ไม่ถูกต้อง" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };
  if (d.comment !== undefined) updates.comment = d.comment;
  if (d.priority !== undefined) updates.priority = d.priority;
  if (d.screenshotKey !== undefined) updates.screenshot_key = d.screenshotKey;
  if (d.status !== undefined) {
    updates.status = d.status;
    updates.fixed_at = d.status === "fixed" ? now : null;
  }
  if (d.fixedCommitSha !== undefined) updates.fixed_commit_sha = d.fixedCommitSha;

  const admin = adminClient();
  const { error } = await admin
    .from("pinpoint_pins")
    .update(updates)
    .eq("id", pinId)
    .eq("org_id", orgId);
  if (error) {
    console.error("[PATCH pin]", error);
    return NextResponse.json({ error: "อัปเดตไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ pinId: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  const { pinId } = await ctx.params;
  if (!zUUID().safeParse(pinId).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  const orgId = session.user.org_id;
  const pin = await loadPin(orgId, pinId);
  if (!pin) return NextResponse.json({ error: "ไม่พบจุด" }, { status: 404 });
  if (pin.session?.author_id !== session.user.id && !isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  if (pin.screenshot_key) await deleteObject(pin.screenshot_key);
  const admin = adminClient();
  const { error } = await admin
    .from("pinpoint_pins")
    .delete()
    .eq("id", pinId)
    .eq("org_id", orgId);
  if (error) {
    console.error("[DELETE pin]", error);
    return NextResponse.json({ error: "ลบไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
