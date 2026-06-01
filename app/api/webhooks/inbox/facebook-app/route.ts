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

// Returns ok + a human reason so we can tell APART the failure modes in logs:
// missing app secret (env not set) vs forged/mismatched signature (wrong secret).
// Without this, a missing FACEBOOK_APP_SECRET silently 401s every event and we
// can't tell FB-isn't-calling from we're-rejecting (BUGSOLVE BE-01/06).
function verifyAppSignature(
  rawBody: string,
  header: string | null,
): { ok: boolean; reason?: string } {
  if (!process.env.FACEBOOK_APP_SECRET) {
    return { ok: false, reason: "FACEBOOK_APP_SECRET not set in env" };
  }
  if (!header) return { ok: false, reason: "missing x-hub-signature-256 header" };
  const expected = crypto
    .createHmac("sha256", process.env.FACEBOOK_APP_SECRET)
    .update(rawBody)
    .digest("hex");
  const got = header.startsWith("sha256=") ? header.slice(7) : header;
  if (expected.length !== got.length) return { ok: false, reason: "signature length mismatch" };
  const match = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  return match ? { ok: true } : { ok: false, reason: "signature mismatch (FACEBOOK_APP_SECRET wrong?)" };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const verdict = verifyAppSignature(rawBody, sig);
  if (!verdict.ok) {
    // FB DID call us but we're dropping it — make this loud (visible in Vercel
    // function logs) so "zero messages" can be diagnosed (BUGSOLVE BE-01/03).
    console.error(
      `[fb-app-webhook] REJECTED inbound event: ${verdict.reason}. FB reached us but the event was dropped before ingest.`,
    );
    return NextResponse.json({ error: "invalid signature", reason: verdict.reason }, { status: 401 });
  }
  console.log(
    `[fb-app-webhook] accepted event · entries=${(() => {
      try {
        return (JSON.parse(rawBody) as FbWebhookBody).entry?.length ?? 0;
      } catch {
        return "?";
      }
    })()}`,
  );

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
        // FB sent us an event for a page we don't have a channel for — visible
        // so the CEO can tell "page subscribed but not imported" apart.
        console.warn(
          `[fb-app-webhook] event for page ${pageId} but no matching FACEBOOK channel (not imported, or externalId mismatch)`,
        );
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
              `https://graph.facebook.com/${psid}?fields=name`,
              {
                // token in Authorization header, not URL query — avoids leaking
                // it via logs/referrer (BUGSOLVE SEC-04).
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(2000),
              },
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
