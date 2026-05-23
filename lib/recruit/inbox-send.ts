// Outbound message senders for LINE / Facebook channels
//
// Each provider has a slightly different API · we normalize:
//   - LINE Reply (within 1 min using replyToken · free) → fallback to Push (paid)
//   - FB Send API (always push · within 24h messaging window)
//
// Errors get surfaced to the caller so RecruitMessage row can be marked FAILED
// with errorMessage for HR to retry.

interface SendInput {
  body: string;
  recipientExternalId: string;
  accessToken: string;
  replyToken?: string | null;
}

interface SendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const FB_GRAPH_BASE = "https://graph.facebook.com/v19.0";

export async function sendLineMessage(input: SendInput): Promise<SendResult> {
  const message = { type: "text" as const, text: input.body.slice(0, 5000) };

  // Prefer Reply API if we have a fresh replyToken (saves quota)
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
      if (resp.ok) {
        return { ok: true };
      }
      const txt = await resp.text().catch(() => "");
      // Reply token expired (1 min) → fall through to push
      if (resp.status !== 400 && resp.status !== 410) {
        return { ok: false, error: `LINE Reply ${resp.status}: ${txt.slice(0, 200)}` };
      }
    } catch (e) {
      return { ok: false, error: `LINE Reply: ${(e as Error).message}` };
    }
  }

  // Push API (works any time but counts toward monthly quota)
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
      return { ok: false, error: `LINE Push ${resp.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `LINE Push: ${(e as Error).message}` };
  }
}

export async function sendFacebookMessage(input: SendInput): Promise<SendResult> {
  try {
    const resp = await fetch(
      `${FB_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(input.accessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { id: input.recipientExternalId },
          messaging_type: "RESPONSE", // standard messaging window (24h)
          message: { text: input.body.slice(0, 2000) },
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `FB Send ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const data = (await resp.json().catch(() => null)) as { message_id?: string } | null;
    return { ok: true, externalId: data?.message_id };
  } catch (e) {
    return { ok: false, error: `FB Send: ${(e as Error).message}` };
  }
}
