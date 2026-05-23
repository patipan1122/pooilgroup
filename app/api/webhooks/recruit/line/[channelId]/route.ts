// LINE Messaging API webhook receiver
//
// Verifies HMAC signature against the channel's encrypted Channel Secret,
// parses events, matches sender to recruit_applicant (auto-creates if new),
// persists inbound RecruitMessage rows.
//
// Setup steps for the Pooil HR who wires this up:
// 1. Create a LINE Official Account · in LINE Developers Console add a
//    Messaging API channel.
// 2. In /recruit/settings/channels click "เพิ่ม channel" → LINE →
//    paste Channel Secret + Channel Access Token (long-lived).
// 3. Copy our generated webhook URL into LINE Console "Webhook URL" field
//    and enable "Use webhook" + disable "Auto-reply messages".
// 4. Test by sending a message to the OA · should appear in /recruit/messages.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, verifyLineSignature } from "@/lib/recruit/channel-crypto";
import { ingestInboundMessage } from "@/lib/recruit/inbox-ingest";

// LINE event shapes (subset we care about)
interface LineEvent {
  type: string;
  timestamp?: number;
  replyToken?: string;
  source?: { type?: string; userId?: string };
  message?: {
    id?: string;
    type?: string;
    text?: string;
    stickerId?: string;
    contentProvider?: { type?: string };
  };
}
interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const signature = req.headers.get("x-line-signature") ?? "";
  const rawBody = await req.text();

  const channel = await prisma.recruitInboxChannel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      type: true,
      orgId: true,
      status: true,
      webhookSecret: true,
      accessTokenEnc: true,
    },
  });

  if (!channel || channel.type !== "LINE") {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // Decrypt the channel secret stored on our side (= LINE Channel Secret pasted by admin)
  const channelSecret = decryptToken(channel.webhookSecret);
  if (!channelSecret) {
    // Setup not complete — accept silently so LINE doesn't retry forever,
    // but record the event so admin can see something arrived.
    await prisma.recruitInboxChannel.update({
      where: { id: channel.id },
      data: { lastEventAt: new Date(), status: "setup" },
    });
    console.warn("[webhook:LINE] no channel secret set, skipping verify", { channelId });
    return NextResponse.json({ ok: true, warning: "channel secret not set" });
  }

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    console.warn("[webhook:LINE] signature mismatch", { channelId });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Update last event AFTER signature verification passes.
  await prisma.recruitInboxChannel.update({
    where: { id: channel.id },
    data: { lastEventAt: new Date(), status: channel.status === "setup" ? "active" : channel.status },
  });

  // Optional: fetch sender profile name for nicer display.
  // Requires accessToken. We'll fetch lazily inside the events loop.
  const accessToken = decryptToken(channel.accessTokenEnc);

  for (const ev of body.events ?? []) {
    if (ev.type !== "message") continue; // ignore follow/unfollow/postback for now
    const userId = ev.source?.userId;
    if (!userId) continue;

    let bodyText: string;
    let attachments: unknown = null;
    if (ev.message?.type === "text" && ev.message.text) {
      bodyText = ev.message.text;
    } else if (ev.message?.type === "image") {
      bodyText = "[รูปภาพ]";
      attachments = { type: "image", messageId: ev.message.id };
    } else if (ev.message?.type === "sticker") {
      bodyText = "[Sticker]";
      attachments = { type: "sticker", stickerId: ev.message.stickerId };
    } else if (ev.message?.type) {
      bodyText = `[${ev.message.type}]`;
      attachments = { type: ev.message.type };
    } else {
      continue;
    }

    // Try to fetch profile name (cheap call, ~50ms · skip on failure)
    let senderDisplayName: string | null = null;
    if (accessToken) {
      try {
        const profResp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          // Short-circuit if LINE is slow
          signal: AbortSignal.timeout(2000),
        });
        if (profResp.ok) {
          const prof = (await profResp.json()) as { displayName?: string };
          senderDisplayName = prof.displayName ?? null;
        }
      } catch {
        /* ignore */
      }
    }

    try {
      await ingestInboundMessage({
        channelInstanceId: channel.id,
        orgId: channel.orgId,
        channel: "LINE",
        senderExternalId: userId,
        senderDisplayName,
        body: bodyText,
        attachments,
        externalId: ev.message?.id ?? null,
        replyToken: ev.replyToken ?? null,
      });
    } catch (e) {
      if ((e as Error).message === "INGEST_NO_POSTING") {
        // Org has no postings — log and skip
        console.warn("[webhook:LINE] no posting for org · dropped event", { orgId: channel.orgId });
        continue;
      }
      console.error("[webhook:LINE] ingest failed", e);
    }
  }

  return NextResponse.json({ ok: true });
}

// Keep GET for health checks (LINE doesn't use it but our smoke tests do)
export async function GET() {
  return NextResponse.json({ ok: true, service: "recruit-line-webhook" });
}
