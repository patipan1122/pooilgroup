// ClawHub (JOLLY PLAY) — LINE Messaging API thin wrappers.
//
// Uses CLAWHUB-namespaced env per RULE J (CEO 2026-06-08): never share a channel
// across modules. ClawHub has its OWN LINE OA channel:
//   CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN — Messaging API auth (reply/push/content)
//   CLAWHUB_LINE_CHANNEL_SECRET       — webhook signature verification
//
// Outbound mirrors lib/chairops/line/messaging.ts (same endpoints, bounded retry,
// never-throw → returns {ok:false} so webhooks/crons stay green). Signature verify
// reuses verifyLineSignature from lib/recruit/channel-crypto (HMAC-SHA256, base64,
// constant-time), exactly like the ChairOps webhook.

import { verifyLineSignature } from "@/lib/recruit/channel-crypto";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const PROFILE_URL = "https://api.line.me/v2/bot/profile";
const CONTENT_URL = "https://api-data.line.me/v2/bot/message";

/** A LINE message object (text, image, flex, …). Loosely typed by design. */
export type LineMessage = Record<string, unknown>;

export interface LineSendResult {
  ok: boolean;
  error?: string;
}

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function token(): string | undefined {
  return process.env.CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN;
}

async function postWithRetry(
  url: string,
  body: string,
): Promise<LineSendResult> {
  const t = token();
  if (!t) return { ok: false, error: "no-token" };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return { ok: true };
      if (r.status === 429 || r.status >= 500) {
        const retryAfter = Number(r.headers.get("retry-after"));
        const waitSec = Number.isFinite(retryAfter)
          ? Math.min(retryAfter, 3)
          : 0.3 * (attempt + 1);
        if (attempt < 2) {
          await sleep(waitSec * 1000);
          continue;
        }
      }
      const txt = await r.text().catch(() => "");
      return { ok: false, error: `LINE ${r.status}: ${txt.slice(0, 200)}` };
    } catch (e) {
      if (attempt === 2) return { ok: false, error: (e as Error).message };
      await sleep(0.3 * (attempt + 1) * 1000);
    }
  }
  return { ok: false, error: "retry-exhausted" };
}

/** Reply to an inbound event using its replyToken (valid ~30s, single use). */
export async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<LineSendResult> {
  return postWithRetry(
    REPLY_URL,
    JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
  );
}

/** Push messages to a LINE user/group id (no reply token needed). */
export async function pushMessage(
  to: string,
  messages: LineMessage[],
): Promise<LineSendResult> {
  return postWithRetry(
    PUSH_URL,
    JSON.stringify({ to, messages: messages.slice(0, 5) }),
  );
}

/** Convenience: push a single text message. */
export async function pushText(to: string, text: string): Promise<LineSendResult> {
  return pushMessage(to, [{ type: "text", text: text.slice(0, 5000) }]);
}

/** Fetch a LINE user's profile. Returns null on any failure (never throws). */
export async function getLineProfile(userId: string): Promise<LineProfile | null> {
  const t = token();
  if (!t) return null;
  try {
    const r = await fetch(`${PROFILE_URL}/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    return (await r.json()) as LineProfile;
  } catch {
    return null;
  }
}

/**
 * Download an inbound message's binary content (image/sticker) as a Buffer.
 * Uses the api-data host. Returns null on any failure (never throws).
 */
export async function getMessageContent(messageId: string): Promise<Buffer | null> {
  const t = token();
  if (!t) return null;
  try {
    const r = await fetch(
      `${CONTENT_URL}/${encodeURIComponent(messageId)}/content`,
      {
        headers: { Authorization: `Bearer ${t}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Verify a ClawHub LINE webhook signature. Reads CLAWHUB_LINE_CHANNEL_SECRET and
 * delegates to verifyLineSignature (HMAC-SHA256 base64, constant-time). Returns
 * false if the secret is not configured (caller decides whether to 200 or 401).
 */
export function verifyClawhubWebhook(
  rawBody: string,
  signature: string | null | undefined,
): boolean {
  const secret = process.env.CLAWHUB_LINE_CHANNEL_SECRET;
  if (!secret) return false;
  return verifyLineSignature(rawBody, signature ?? "", secret);
}
