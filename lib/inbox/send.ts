// Outbound senders for the unified inbox.
//   - text  : reuse the Recruit LINE/FB helpers (single source of truth)
//   - image : local helpers because Recruit doesn't send media
//
// All four functions share the same SendResult shape so callers can switch
// on `ok` without knowing the underlying provider.

export { sendLineMessage, sendFacebookMessage } from "@/lib/recruit/inbox-send";

export interface InboxSendInput {
  body: string;
  recipientExternalId: string;
  accessToken: string;
  replyToken?: string | null;
}

export interface InboxSendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface InboxImageSendInput {
  /** Public HTTPS URL — providers fetch it directly */
  imageUrl: string;
  /** Optional thumbnail; LINE recommends < 240×240 · falls back to imageUrl */
  previewUrl?: string;
  recipientExternalId: string;
  accessToken: string;
  /** LINE reply token — saves push quota when fresh */
  replyToken?: string | null;
}

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const FB_GRAPH_BASE = "https://graph.facebook.com/v19.0";

type LineMessage =
  | { type: "text"; text: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string };

/**
 * Send text + optional image as ONE LINE Reply/Push call (up to 5 messages
 * per call per the LINE API).  Delivered atomically — the customer sees
 * both bubbles together with a single notification, instead of "text
 * arrived" then a second ping "image arrived".
 *
 * Used by the bot when a flow template has an attached image so the reply
 * lands as one unit.  Falls back to plain text when imageUrl is omitted.
 */
export async function sendLineTextPlusImage(input: {
  body: string;
  imageUrl?: string;
  recipientExternalId: string;
  accessToken: string;
  replyToken?: string | null;
}): Promise<InboxSendResult> {
  const messages: LineMessage[] = [
    { type: "text", text: input.body.slice(0, 5000) },
  ];
  if (input.imageUrl) {
    messages.push({
      type: "image",
      originalContentUrl: input.imageUrl,
      previewImageUrl: input.imageUrl,
    });
  }

  if (input.replyToken) {
    try {
      const resp = await fetch(LINE_REPLY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({ replyToken: input.replyToken, messages }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) return { ok: true };
      const txt = await resp.text().catch(() => "");
      // Stale reply token (1 min) → fall through to push.
      if (resp.status !== 400 && resp.status !== 410) {
        return { ok: false, error: `LINE Reply combo ${resp.status}: ${txt.slice(0, 200)}` };
      }
    } catch (e) {
      return { ok: false, error: `LINE Reply combo: ${(e as Error).message}` };
    }
  }

  try {
    const resp = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({ to: input.recipientExternalId, messages }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `LINE Push combo ${resp.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `LINE Push combo: ${(e as Error).message}` };
  }
}

/** Send an image via LINE.  Mirrors text helper: reply first, push on miss. */
export async function sendLineImage(
  input: InboxImageSendInput,
): Promise<InboxSendResult> {
  const message = {
    type: "image" as const,
    originalContentUrl: input.imageUrl,
    previewImageUrl: input.previewUrl || input.imageUrl,
  };

  if (input.replyToken) {
    try {
      const resp = await fetch(LINE_REPLY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({ replyToken: input.replyToken, messages: [message] }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return { ok: true };
      const txt = await resp.text().catch(() => "");
      // Stale reply token (1 min) → fall through to push.
      if (resp.status !== 400 && resp.status !== 410) {
        return { ok: false, error: `LINE Reply image ${resp.status}: ${txt.slice(0, 200)}` };
      }
    } catch (e) {
      return { ok: false, error: `LINE Reply image: ${(e as Error).message}` };
    }
  }

  try {
    const resp = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({ to: input.recipientExternalId, messages: [message] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `LINE Push image ${resp.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `LINE Push image: ${(e as Error).message}` };
  }
}

/** Send an image via FB Page Messenger Send API. */
export async function sendFacebookImage(
  input: InboxImageSendInput,
): Promise<InboxSendResult> {
  try {
    const resp = await fetch(
      `${FB_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(input.accessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { id: input.recipientExternalId },
          messaging_type: "RESPONSE",
          message: {
            attachment: {
              type: "image",
              payload: { url: input.imageUrl, is_reusable: true },
            },
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `FB Send image ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const data = (await resp.json().catch(() => null)) as { message_id?: string } | null;
    return { ok: true, externalId: data?.message_id };
  } catch (e) {
    return { ok: false, error: `FB Send image: ${(e as Error).message}` };
  }
}
