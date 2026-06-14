// Pinpoint — add a pin to a draft session
//   POST /api/pinpoint/sessions/[id]/pins   (admin tier · session owner)
//
// The pin is saved to the DB immediately (never lost to a tab crash). The
// screenshot is attached later via PATCH /api/pinpoint/pins/[pinId] once the
// client's best-effort capture+upload resolves — saving a pin NEVER waits on it.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { pinpointV1 } from "@/lib/pinpoint/flags";

const PinSchema = z.object({
  url: z.string().min(1).max(500),
  comment: z.string().max(2000).optional(),
  priority: z.enum(["urgent", "normal"]).optional(),
  elementSelector: z.string().max(1000).optional().nullable(),
  elementText: z.string().max(200).optional().nullable(),
  elementMeta: z.record(z.string(), z.unknown()).optional().nullable(),
  coordXPct: z.number().min(0).max(100).optional().nullable(),
  coordYPct: z.number().min(0).max(100).optional().nullable(),
  viewportW: z.number().int().positive().max(20000).optional().nullable(),
  viewportH: z.number().int().positive().max(20000).optional().nullable(),
  screenshotKey: z.string().max(500).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "เฉพาะแอดมิน" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!zUUID().safeParse(id).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = PinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const d = parsed.data;

  // A screenshot key must live under THIS user's R2 prefix (can't attach
  // someone else's object). Same guard as the bug-report API.
  if (d.screenshotKey && !d.screenshotKey.startsWith(`users/${session.user.id}/`)) {
    return NextResponse.json({ error: "screenshotKey ไม่ถูกต้อง" }, { status: 400 });
  }

  const orgId = session.user.org_id;
  const admin = adminClient();

  // Session must exist in-org, be a draft, and be owned by the caller (or super_admin).
  const { data: sess } = await admin
    .from("pinpoint_sessions")
    .select("id, author_id, status, pin_count")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!sess) return NextResponse.json({ error: "ไม่พบ session" }, { status: 404 });
  const s = sess as { author_id: string; status: string; pin_count: number };
  if (s.author_id !== session.user.id && !isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }
  if (s.status !== "draft") {
    return NextResponse.json({ error: "session ส่งไปแล้ว" }, { status: 409 });
  }

  const seq = (s.pin_count ?? 0) + 1;
  const pinId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: insErr } = await admin.from("pinpoint_pins").insert({
    id: pinId,
    session_id: id,
    org_id: orgId,
    seq,
    url: d.url,
    element_selector: d.elementSelector ?? null,
    element_text: d.elementText ?? null,
    element_meta: d.elementMeta ?? null,
    coord_x_pct: d.coordXPct ?? null,
    coord_y_pct: d.coordYPct ?? null,
    viewport_w: d.viewportW ?? null,
    viewport_h: d.viewportH ?? null,
    comment: d.comment ?? null,
    priority: d.priority ?? "normal",
    status: "open",
    screenshot_key: d.screenshotKey ?? null,
    created_at: now,
    updated_at: now,
  });
  if (insErr) {
    console.error("[POST pin]", insErr);
    return NextResponse.json({ error: "บันทึกจุดไม่สำเร็จ" }, { status: 500 });
  }

  // Keep the session's denormalized count in step (display/seq only).
  await admin
    .from("pinpoint_sessions")
    .update({ pin_count: seq, updated_at: now })
    .eq("id", id)
    .eq("org_id", orgId);

  return NextResponse.json({ id: pinId, seq });
}
