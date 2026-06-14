// Pinpoint — export a session as "copy for Claude" markdown (super_admin only).
//   GET /api/pinpoint/sessions/[id]/export
//
// PDPA: this is the deliberate, gated step where screenshots/structured context
// leave the app. super_admin-only + audited. Marks the session exported.

import { NextResponse, type NextRequest } from "next/server";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { pinpointV1 } from "@/lib/pinpoint/flags";
import { getSessionWithPins } from "@/lib/pinpoint/data";
import { sessionToMarkdown } from "@/lib/pinpoint/markdown";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: "เฉพาะ super_admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!zUUID().safeParse(id).success) {
    return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
  }

  const result = await getSessionWithPins(session.user.org_id, id);
  if (!result) {
    return NextResponse.json({ error: "ไม่พบ session" }, { status: 404 });
  }

  const appOrigin =
    process.env.APP_ORIGIN || new URL(req.url).origin || "";
  const md = sessionToMarkdown(result.session, result.pins, {
    appOrigin,
    r2PublicUrl: process.env.R2_PUBLIC_URL ?? "",
  });

  // Mark exported (don't downgrade a 'reviewed'/'closed' session's status badge
  // unnecessarily — just stamp exported_at; bump status to 'exported' if still
  // submitted).
  const now = new Date().toISOString();
  const admin = adminClient();
  const updates: Record<string, unknown> = { exported_at: now, updated_at: now };
  if (result.session.status === "submitted") updates.status = "exported";
  await admin
    .from("pinpoint_sessions")
    .update(updates)
    .eq("id", id)
    .eq("org_id", session.user.org_id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "pinpoint_session",
    resourceId: id,
    diff: { new: { pins: result.pins.length } },
    ...getRequestMeta(req),
  });

  const format = new URL(req.url).searchParams.get("format");
  if (format === "raw") {
    return new NextResponse(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
  return NextResponse.json({ markdown: md });
}
