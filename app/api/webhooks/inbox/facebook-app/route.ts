// App-level FB Messenger webhook — receives events for ALL pages in the
// app and fans them out to the right InboxChannel by Page ID.  Use this
// route in the FB App's Messenger product config; per-page channels add
// themselves automatically when imported via OAuth.
//
// Setup in FB App console (Messenger → Webhooks):
//   Webhook URL    : https://<host>/api/webhooks/inbox/facebook-app
//   Verify Token   : value of env FACEBOOK_WEBHOOK_VERIFY_TOKEN (you pick)
//   Subscribe to   : messages, messaging_postbacks
//
// Signature verification uses FACEBOOK_APP_SECRET (HMAC SHA-256 hex,
// `sha256=` prefix in x-hub-signature-256).

import { NextRequest, NextResponse, after } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/inbox/crypto";
import { ingestInboundMessage } from "@/lib/inbox/ingest";
import { rehostFacebookImage } from "@/lib/inbox/inbound-media";
import { runBot, handleNonTextInbound } from "@/lib/inbox/bot/engine";

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

function verifyAppSignature(rawBody: string, header: string | null): boolean {
  if (!header || !process.env.FACEBOOK_APP_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", process.env.FACEBOOK_APP_SECRET)
    .update(rawBody)
    .digest("hex");
  const got = header.startsWith("sha256=") ? header.slice(7) : header;
  if (expected.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifyAppSignature(rawBody, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: FbWebhookBody;
  try {
    body = JSON.parse(rawBody) as FbWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // 200 fast; process in `after()` so FB doesn't retry/back off.
  after(async () => {
    for (const entry of body.entry ?? []) {
      const pageId = entry.id;
      if (!pageId) continue;

      // Look up which channel this page belongs to.  externalId stores the
      // FB Page ID for FB channels (set by the OAuth import flow).
      const channel = await prisma.inboxChannel.findFirst({
        where: { platform: "FACEBOOK", externalId: pageId },
        select: {
          id: true,
          orgId: true,
          businessTag: true,
          botEnabled: true,
          createdById: true,
          accessTokenEnc: true,
        },
      });
      if (!channel) {
        console.warn("[fb-app-webhook] unknown page", pageId);
        continue;
      }

      const accessToken = decryptToken(channel.accessTokenEnc);
      const ch = {
        id: channel.id,
        orgId: channel.orgId,
        platform: "FACEBOOK" as const,
        businessTag: channel.businessTag,
        createdById: channel.createdById,
      };

      await prisma.inboxChannel
        .update({ where: { id: ch.id }, data: { lastEventAt: new Date() } })
        .catch(() => {});

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
            channelId: ch.id,
            orgId: ch.orgId,
            platform: "FACEBOOK",
            senderExternalId: psid,
            senderDisplayName,
            body: bodyText,
            attachments,
            externalId: m.message.mid ?? null,
          });

          // FB CDN URLs expire fast — mirror images to R2 like the legacy
          // per-channel route does.
          const fbAttachment = m.message.attachments?.[0];
          if (
            !res.duplicate &&
            fbAttachment?.type === "image" &&
            fbAttachment.payload?.url
          ) {
            const att = await rehostFacebookImage({
              orgId: ch.orgId,
              conversationId: res.conversationId,
              sourceUrl: fbAttachment.payload.url,
              providerMessageId: m.message.mid ?? undefined,
            });
            if (att) {
              await prisma.inboxMessage
                .update({
                  where: { id: res.messageId },
                  data: { attachments: att as object },
                })
                .catch((e) =>
                  console.error("[fb-app-webhook] patch attachment failed", e),
                );
            }
          }

          if (!res.duplicate && channel.botEnabled && accessToken) {
            const botInput = {
              channel: ch,
              conversationId: res.conversationId,
              externalUserId: psid,
              text: bodyText,
              accessToken,
              replyToken: null,
            };
            if (isText) await runBot(botInput);
            else await handleNonTextInbound({ ...botInput, nonText: true });
          }
        } catch (e) {
          console.error("[fb-app-webhook] process failed", e);
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}

// FB verifies the webhook URL with a GET challenge containing our verify
// token.  Use the env var FACEBOOK_WEBHOOK_VERIFY_TOKEN so CEO can rotate
// without touching code.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!mode) {
    return NextResponse.json({ ok: true, service: "inbox-facebook-app-webhook" });
  }
  const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && challenge && expected && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token mismatch" }, { status: 403 });
}
