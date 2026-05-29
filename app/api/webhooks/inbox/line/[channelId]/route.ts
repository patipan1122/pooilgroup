// LINE Messaging API webhook — unified inbox.
// Verifies HMAC against the channel's encrypted Channel Secret, then returns
// 200 IMMEDIATELY and does ingest + bot reply in `after()` — LINE requires a
// fast 200 or it retries/auto-disables the webhook (audit P0-1).
//
// Setup (per channel):
//  1. LINE Developers Console → Messaging API channel.
//  2. /inbox/settings/channels → add LINE channel → paste Channel Secret +
//     Channel Access Token, set "ธุรกิจ" = เก้าอี้นวด, toggle bot ON.
//  3. Paste this route's URL into LINE "Webhook URL", enable "Use webhook",
//     and DISABLE LINE auto-reply (so our bot is the only responder).

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, verifyLineSignature } from "@/lib/inbox/crypto";
import { ingestInboundMessage } from "@/lib/inbox/ingest";
import { runBot, handleNonTextInbound } from "@/lib/inbox/bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string; stickerId?: string };
}
interface LineWebhookBody {
  events?: LineEvent[];
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const signature = req.headers.get("x-line-signature") ?? "";
  const rawBody = await req.text();

  const channel = await prisma.inboxChannel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      platform: true,
      orgId: true,
      status: true,
      businessTag: true,
      botEnabled: true,
      createdById: true,
      webhookSecret: true,
      accessTokenEnc: true,
    },
  });

  if (!channel || channel.platform !== "LINE") {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  const channelSecret = decryptToken(channel.webhookSecret);
  if (!channelSecret) {
    await prisma.inboxChannel
      .update({ where: { id: channel.id }, data: { lastEventAt: new Date(), status: "setup" } })
      .catch(() => {});
    return NextResponse.json({ ok: true, warning: "channel secret not set" });
  }

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const accessToken = decryptToken(channel.accessTokenEnc);
  const ch = {
    id: channel.id,
    orgId: channel.orgId,
    platform: "LINE" as const,
    businessTag: channel.businessTag,
    createdById: channel.createdById,
  };
  const wasSetup = channel.status === "setup";
  const botEnabled = channel.botEnabled;

  // Return 200 NOW; process events after the response (LINE wants a fast 200).
  after(async () => {
    try {
      await prisma.inboxChannel
        .update({
          where: { id: ch.id },
          data: { lastEventAt: new Date(), status: wasSetup ? "active" : undefined },
        })
        .catch(() => {});

      for (const ev of body.events ?? []) {
        if (ev.type !== "message") continue;
        const userId = ev.source?.userId;
        if (!userId) continue;

        let bodyText: string;
        let attachments: unknown = null;
        const isText = ev.message?.type === "text" && !!ev.message.text;
        if (isText) {
          bodyText = ev.message!.text!;
        } else if (ev.message?.type === "image") {
          bodyText = "[รูปภาพ]";
          attachments = { type: "image", messageId: ev.message.id };
        } else if (ev.message?.type === "sticker") {
          bodyText = "[สติกเกอร์]";
          attachments = { type: "sticker", stickerId: ev.message.stickerId };
        } else if (ev.message?.type) {
          bodyText = `[${ev.message.type}]`;
          attachments = { type: ev.message.type };
        } else {
          continue;
        }

        let senderDisplayName: string | null = null;
        if (accessToken) {
          try {
            const profResp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
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
          const res = await ingestInboundMessage({
            channelId: ch.id,
            orgId: ch.orgId,
            platform: "LINE",
            senderExternalId: userId,
            senderDisplayName,
            body: bodyText,
            attachments,
            externalId: ev.message?.id ?? null,
          });

          if (!res.duplicate && botEnabled) {
            const botInput = {
              channel: ch,
              conversationId: res.conversationId,
              externalUserId: userId,
              text: bodyText,
              accessToken,
              replyToken: ev.replyToken ?? null,
            };
            if (isText) await runBot(botInput);
            else await handleNonTextInbound({ ...botInput, nonText: true });
          }
        } catch (e) {
          console.error("[webhook:inbox:LINE] process failed", e);
        }
      }
    } catch (e) {
      console.error("[webhook:inbox:LINE] after() failed", e);
    }
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "inbox-line-webhook" });
}
