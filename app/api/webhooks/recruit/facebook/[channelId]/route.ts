// Facebook Page Messenger webhook receiver
//
// Setup steps for Pooil HR:
// 1. Create a Facebook App in https://developers.facebook.com (Business type) ·
//    add the "Messenger" product · subscribe to `messages` events.
// 2. In /recruit/settings/channels add a Facebook channel · paste:
//    - Page Access Token (long-lived · for outbound replies)
//    - App Secret (for HMAC verification)
// 3. Copy our generated webhook URL into the FB App's webhook config ·
//    paste the "verify token" we show into the "Verify Token" field.
// 4. FB sends GET with hub.challenge → we echo it back if verify token matches.
// 5. After subscription FB POSTs messaging events here.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, verifyFacebookSignature } from "@/lib/recruit/channel-crypto";
import { ingestInboundMessage } from "@/lib/recruit/inbox-ingest";

interface FbMessage {
  mid?: string;
  text?: string;
  attachments?: Array<{ type?: string; payload?: { url?: string } }>;
}
interface FbMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: FbMessage;
}
interface FbEntry {
  id?: string; // page id
  time?: number;
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

  if (!channel || channel.type !== "FACEBOOK") {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  const appSecret = decryptToken(channel.webhookSecret);
  if (!appSecret) {
    await prisma.recruitInboxChannel.update({
      where: { id: channel.id },
      data: { lastEventAt: new Date(), status: "setup" },
    });
    console.warn("[webhook:FB] no app secret set, skipping verify", { channelId });
    return NextResponse.json({ ok: true, warning: "app secret not set" });
  }

  if (!verifyFacebookSignature(rawBody, signature, appSecret)) {
    console.warn("[webhook:FB] signature mismatch", { channelId });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: FbWebhookBody;
  try {
    body = JSON.parse(rawBody) as FbWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  await prisma.recruitInboxChannel.update({
    where: { id: channel.id },
    data: { lastEventAt: new Date(), status: channel.status === "setup" ? "active" : channel.status },
  });

  // FB allows GET profile via /{psid}?fields=name with the Page Access Token
  const accessToken = decryptToken(channel.accessTokenEnc);

  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const psid = m.sender?.id;
      if (!psid) continue;
      if (!m.message) continue; // skip postbacks / delivery / read events

      let bodyText: string;
      let attachments: unknown = null;
      if (m.message.text) {
        bodyText = m.message.text;
      } else if (m.message.attachments && m.message.attachments.length > 0) {
        const a = m.message.attachments[0];
        bodyText = `[${a.type ?? "attachment"}]`;
        attachments = m.message.attachments;
      } else {
        continue;
      }

      // Best-effort profile fetch
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
        await ingestInboundMessage({
          channelInstanceId: channel.id,
          orgId: channel.orgId,
          channel: "FACEBOOK",
          senderExternalId: psid,
          senderDisplayName,
          body: bodyText,
          attachments,
          externalId: m.message.mid ?? null,
        });
      } catch (e) {
        if ((e as Error).message === "INGEST_NO_POSTING") {
          console.warn("[webhook:FB] no posting for org · dropped event", { orgId: channel.orgId });
          continue;
        }
        console.error("[webhook:FB] ingest failed", e);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// FB webhook verification GET — echo hub.challenge when verify token matches.
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
    // Plain health check
    return NextResponse.json({ ok: true, service: "recruit-facebook-webhook" });
  }

  const channel = await prisma.recruitInboxChannel.findUnique({
    where: { id: channelId },
    select: { metadata: true },
  });
  const expectedToken = ((channel?.metadata ?? {}) as { verifyToken?: string }).verifyToken;

  if (mode === "subscribe" && token && challenge && token === expectedToken) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "verify_token mismatch" }, { status: 403 });
}
