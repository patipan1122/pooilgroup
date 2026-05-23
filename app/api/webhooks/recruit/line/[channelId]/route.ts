// LINE OA webhook receiver (SCAFFOLDING)
//
// CEO 2026-05-23: "คนสมัครทักมาใน line oa แล้วมาโผล่ในนี้เลย"
//
// CURRENT STATE: stub responds 200 + logs payload so we don't lose events
// while wiring up signature verification + applicant matching.
//
// TODO (next session):
// 1. Verify X-Line-Signature using channel.webhookSecret (HMAC-SHA256)
// 2. Parse event types (message, follow, postback)
// 3. Match LINE userId → existing recruit_applicant or create new
// 4. Persist text/image/file events to recruit_messages
//    (direction=IN, channel=LINE, status=READ_REQUIRED)
// 5. Push web-socket / Server-Sent Events to /recruit/messages so HR sees live
//
// See docs/RECRUIT_OMNICHAT_PLAN.md for full architecture.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const signature = req.headers.get("x-line-signature");

  // Look up channel — verify it exists, store last_event_at for debugging
  const channel = await prisma.recruitInboxChannel.findUnique({
    where: { id: channelId },
    select: { id: true, type: true, status: true, orgId: true, webhookSecret: true },
  });

  if (!channel || channel.type !== "LINE") {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // TODO: actual HMAC-SHA256 verify against signature + channel.webhookSecret
  // For now we record arrival so admin can see "channel received first event"

  await prisma.recruitInboxChannel.update({
    where: { id: channelId },
    data: { lastEventAt: new Date() },
  });

  // SCAFFOLDING — log raw payload so we can inspect first real events.
  // Replace with applicant-matching + persistence in next iteration.
  const body = await req.json().catch(() => ({}));
  console.log("[webhook:LINE]", {
    channelId,
    signaturePresent: !!signature,
    eventCount: Array.isArray((body as { events?: unknown[] }).events)
      ? (body as { events: unknown[] }).events.length
      : 0,
  });

  return NextResponse.json({ ok: true });
}

// LINE pings the URL with GET to verify it's reachable
export async function GET() {
  return NextResponse.json({ ok: true, service: "recruit-line-webhook" });
}
