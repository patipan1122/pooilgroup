// Pinpoint — single session
//   GET    /api/pinpoint/sessions/[id]            : session + pins (owner or super_admin)
//   PATCH  /api/pinpoint/sessions/[id]            : finish | review | close | rename
//   DELETE /api/pinpoint/sessions/[id]            : discard (also purges screenshots)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { deleteObject } from "@/lib/r2/upload";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { pinpointV1 } from "@/lib/pinpoint/flags";
import { sessionSummary } from "@/lib/pinpoint/markdown";
import type { PinpointPin } from "@/lib/pinpoint/types";

const PatchSchema = z.object({
  action: z.enum(["finish", "review", "close", "rename", "recording"]),
  title: z.string().max(200).optional(),
  // R2 key of the per-session screen recording; null clears it.
  recordingKey: z.string().max(300).nullable().optional(),
});

async function loadSession(orgId: string, id: string) {
  const admin = adminClient();
  const { data } = await admin
    .from("pinpoint_sessions")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data as
    | { id: string; author_id: string; status: string; pin_count: number }
    | null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  const { id } = await ctx.params;
  if (!zUUID().safeParse(id).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  const sess = await loadSession(session.user.org_id, id);
  if (!sess) return NextResponse.json({ error: "ไม่พบ session" }, { status: 404 });
  // Owner sees own; super_admin sees any in-org.
  if (sess.author_id !== session.user.id && !isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }
  const admin = adminClient();
  const { data: pins } = await admin
    .from("pinpoint_pins")
    .select("*")
    .eq("org_id", session.user.org_id)
    .eq("session_id", id)
    .order("seq", { ascending: true });
  return NextResponse.json({ session: sess, pins: pins ?? [] });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  const { id } = await ctx.params;
  if (!zUUID().safeParse(id).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { action, title } = parsed.data;
  const meta = getRequestMeta(req);
  const orgId = session.user.org_id;
  const admin = adminClient();
  const sess = await loadSession(orgId, id);
  if (!sess) return NextResponse.json({ error: "ไม่พบ session" }, { status: 404 });

  const isOwner = sess.author_id === session.user.id;
  const now = new Date().toISOString();

  if (action === "rename") {
    if (!isOwner && !isSuperAdmin(session.user.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
    }
    await admin
      .from("pinpoint_sessions")
      .update({ title: title ?? null, updated_at: now })
      .eq("id", id)
      .eq("org_id", orgId);
    return NextResponse.json({ ok: true });
  }

  if (action === "recording") {
    // Owner attaches the screen recording to their own session (super_admin any).
    if (!isOwner && !isSuperAdmin(session.user.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
    }
    const key = parsed.data.recordingKey ?? null;
    // Defense: only accept a key inside this user's own R2 namespace so a client
    // can't point the session at an arbitrary object (same guard as pins).
    if (key && !key.startsWith(`users/${session.user.id}/`)) {
      return NextResponse.json({ error: "key ไม่ถูกต้อง" }, { status: 400 });
    }
    // Replacing an existing recording → best-effort delete the old object first.
    const prev = sess as unknown as { recording_key?: string | null };
    if (prev.recording_key && prev.recording_key !== key) {
      await deleteObject(prev.recording_key);
    }
    await admin
      .from("pinpoint_sessions")
      .update({ recording_key: key, updated_at: now })
      .eq("id", id)
      .eq("org_id", orgId);
    return NextResponse.json({ ok: true });
  }

  if (action === "finish") {
    // Owner finishes own; super_admin can finish any in-org.
    if (!isOwner && !isSuperAdmin(session.user.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
    }
    if (sess.status !== "draft") {
      return NextResponse.json({ error: "session ส่งไปแล้ว" }, { status: 409 });
    }
    const { data: pins } = await admin
      .from("pinpoint_pins")
      .select("*")
      .eq("org_id", orgId)
      .eq("session_id", id)
      .order("seq", { ascending: true });
    const pinList = (pins ?? []) as unknown as PinpointPin[];
    if (pinList.length === 0) {
      return NextResponse.json({ error: "ยังไม่มีจุดติชม" }, { status: 400 });
    }

    // Claim the session atomically (audit A3): the conditional UPDATE flips
    // draft→submitted only for the FIRST concurrent finish; a duplicate finish
    // matches 0 rows and bails — so exactly one bug_reports row is ever created.
    const { data: claimed } = await admin
      .from("pinpoint_sessions")
      .update({
        status: "submitted",
        pin_count: pinList.length,
        finished_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("org_id", orgId)
      .eq("status", "draft")
      .select("id");
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: "session ส่งไปแล้ว" }, { status: 409 });
    }

    // Now safe to create exactly one consolidated bug_reports row.
    const bugId = crypto.randomUUID();
    const firstUrl = pinList[0]?.url || "/";
    const { error: bugErr } = await admin.from("bug_reports").insert({
      id: bugId,
      org_id: orgId,
      reporter_id: sess.author_id,
      url: firstUrl,
      description: sessionSummary(pinList),
      status: "new",
      created_at: now,
      updated_at: now,
    });
    if (bugErr) {
      console.error("[pinpoint finish] bug insert", bugErr);
      // Session is already 'submitted' (re-finish blocked) and the pins are
      // intact — only the /bugs mirror is missing. Surface a soft error.
      return NextResponse.json(
        { error: "สร้างใบสรุปไม่สำเร็จ (จุดติชมยังอยู่ครบ)" },
        { status: 500 },
      );
    }

    await admin
      .from("pinpoint_sessions")
      .update({ consolidated_report_id: bugId, updated_at: now })
      .eq("id", id)
      .eq("org_id", orgId);

    await audit({
      orgId,
      userId: session.user.id,
      action: "CREATE_REPORT",
      resourceType: "pinpoint_session",
      resourceId: id,
      diff: { new: { pins: pinList.length, bugId } },
      ...meta,
    });
    return NextResponse.json({ ok: true, bugId });
  }

  // review | close — super_admin only
  if (!isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: "เฉพาะ super_admin" }, { status: 403 });
  }
  const updates: Record<string, unknown> = { updated_at: now };
  if (action === "review") {
    updates.status = "reviewed";
    updates.reviewed_by_id = session.user.id;
    updates.reviewed_at = now;
  } else if (action === "close") {
    updates.status = "closed";
  }
  await admin
    .from("pinpoint_sessions")
    .update(updates)
    .eq("id", id)
    .eq("org_id", orgId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  const { id } = await ctx.params;
  if (!zUUID().safeParse(id).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  const orgId = session.user.org_id;
  const admin = adminClient();
  const sess = await loadSession(orgId, id);
  if (!sess) return NextResponse.json({ error: "ไม่พบ session" }, { status: 404 });
  if (sess.author_id !== session.user.id && !isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  // Best-effort R2 cleanup before the cascade delete removes the keys.
  const { data: pins } = await admin
    .from("pinpoint_pins")
    .select("screenshot_key")
    .eq("org_id", orgId)
    .eq("session_id", id);
  for (const p of (pins ?? []) as { screenshot_key: string | null }[]) {
    if (p.screenshot_key) await deleteObject(p.screenshot_key);
  }
  // ...and the per-session screen recording, if any.
  const { data: sessRow } = await admin
    .from("pinpoint_sessions")
    .select("recording_key")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  const recKey = (sessRow as { recording_key: string | null } | null)?.recording_key;
  if (recKey) await deleteObject(recKey);

  const { error } = await admin
    .from("pinpoint_sessions")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) {
    console.error("[DELETE /pinpoint/sessions]", error);
    return NextResponse.json({ error: "ลบไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
