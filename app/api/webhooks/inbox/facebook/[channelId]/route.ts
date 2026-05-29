// Facebook Page Messenger webhook — unified inbox.
// GET = verify-token challenge. POST = verify HMAC, persist inbound message,
// then run the AI bot if this channel has it enabled.
//
// Setup (per channel):
//  1. developers.facebook.com → Business app → add Messenger → subscribe `messages`.
//  2. /inbox/settings/channels → add Facebook channel → paste Page Access Token
//     + App Secret · set "ธุรกิจ" + toggle bot.
//  3. Paste this route's URL + the verify token we show into the FB webhook config.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, verifyFacebookSignature } from "@/lib/inbox/crypto";
import { ingestInboundMessage } from "@/lib/inbox/ingest";
import { runBot } from "@/lib/inbox/bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FbMessage {
  mid?: string;
  text?: string;
  attachments?: Array<{ type?: string; payload?: { url?: string } }>;
}
interface FbMessaging {
  sender?: { id?: string };
  message?: FbMessage;
}
interface FbEntry {
  id?: string;
  messaging?: FbMessaging[];
}
interface FbWebhookBody {
  object?: string;
  entry?: FbEntry[];
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const signature = req.headers.get("x-hub-signature-256") ?? "";
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

  if (!channel || channel.platform !== "FACEBOOK") {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  const appSecret = decryptToken(channel.webhookSecret);
  if (!appSecret) {
    await prisma.inboxChannel.update({
      where: { id: channel.id },
      data: { lastEventAt: new Date(), status: "setup" },
    });
    return NextResponse.json({ ok: true, warning: "app secret not set" });
  }

  if (!verifyFacebookSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: FbWebhookBody;
  try {
    body = JSON.parse(rawBody) as FbWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  await prisma.inboxChannel.update({
    where: { id: channel.id },
    data: {
      lastEventAt: new Date(),
      status: channel.status === "setup" ? "active" : channel.status,
    },
  });

  const accessToken = decryptToken(channel.accessTokenEnc);

  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const psid = m.sender?.id;
      if (!psid || !m.message) continue;

      let bodyText: string;
      let attachments: unknown = null;
      const isText = !!m.message.text;
      if (isText) {
        bodyText = m.message.text!;
      } else if (m.message.attachments && m.message.attachments.length > 0) {
        bodyText = `[${m.message.attachments[0].type ?? "attachment"}]`;
        attachments = m.message.attachments;
      } else {
        continue;
      }

      let senderDisplayName: string | null = null;
      if (accessToken) {
        try {
          const profResp = await fetch(
            `https://graph.facebook.com/${psid}?fields=name&access_token=${encodeURIComponent(accessToken)}`,
            { signal: AbortSignal.timeout(2000) },
          );
          if (profResp.ok) {
            const prof = (await profResp.json()) as { name?: string };
            senderDisplayName = prof.name ?? null;
          }
        } catch {
          /* ignore */
        }
      }

      try {
        const res = await ingestInboundMessage({
          channelId: channel.id,
          orgId: channel.orgId,
          platform: "FACEBOOK",
          senderExternalId: psid,
          senderDisplayName,
          body: bodyText,
          attachments,
          externalId: m.message.mid ?? null,
        });

        if (!res.duplicate && isText && channel.botEnabled && accessToken) {
          await runBot({
            channel: {
              id: channel.id,
              orgId: channel.orgId,
              platform: "FACEBOOK",
              businessTag: channel.businessTag,
              createdById: channel.createdById,
            },
            conversationId: res.conversationId,
            externalUserId: psid,
            text: bodyText,
            accessToken,
            replyToken: null,
          });
        }
      } catch (e) {
        console.error("[webhook:inbox:FB] ingest failed", e);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!mode) {
    return NextResponse.json({ ok: true, service: "inbox-facebook-webhook" });
  }

  const channel = await prisma.inboxChannel.findUnique({
    where: { id: channelId },
    select: { metadata: true },
  });
  const md = (channel?.metadata ?? {}) as { verifyTokenEnc?: string };
  const expectedToken = md.verifyTokenEnc ? decryptToken(md.verifyTokenEnc) : null;

  if (mode === "subscribe" && token && challenge && expectedToken && token === expectedToken) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "verify_token mismatch" }, { status: 403 });
}
