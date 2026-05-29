// ChairOps LINE OA outbound — Messaging API (replaces EOL LINE Notify).
//
// One adapter for all ChairOps outbound (AUDIT D-CO-M4). Resolves the 5 legacy
// role-channels to 5 LINE group IDs in env (CHAIROPS_LINE_GROUP_*). During the OA
// transition it falls back to the legacy `sendLineNotify` so alerts keep
// working until the CEO finishes business verification + supplies the
// Messaging token. NEVER throws — returns {ok:false} so crons stay green.
//
// Activation (CEO, see scripts/chairops-richmenu.mjs + AUDIT §5):
//   CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN  — Messaging API push auth
//   CHAIROPS_LINE_GROUP_FINANCE/REPAIR/OPS/BRANCH/CEO — group IDs (read from webhook
//                                              `join` event after inviting OA)

import { sendLineNotify } from "./notify";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

export type ChairopsLineChannel = "finance" | "repair" | "ops" | "branch" | "ceo";

const GROUP_ENV: Record<ChairopsLineChannel, string> = {
  finance: "CHAIROPS_LINE_GROUP_FINANCE",
  repair: "CHAIROPS_LINE_GROUP_REPAIR",
  ops: "CHAIROPS_LINE_GROUP_OPS",
  branch: "CHAIROPS_LINE_GROUP_BRANCH",
  ceo: "CHAIROPS_LINE_GROUP_CEO",
};

export interface LineSendResult {
  ok: boolean;
  via?: "messaging" | "notify";
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Push a text message to a LINE user/group id via the Messaging API.
// Retries 429/5xx with bounded backoff; honours Retry-After (capped 3s) so a
// serverless invocation never blocks past the request budget.
async function pushRaw(to: string, text: string): Promise<LineSendResult> {
  const token = process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "no-token" };

  const body = JSON.stringify({
    to,
    messages: [{ type: "text", text: text.slice(0, 5000) }],
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(PUSH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return { ok: true, via: "messaging" };
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
      const t = await r.text().catch(() => "");
      return { ok: false, error: `LINE Push ${r.status}: ${t.slice(0, 200)}` };
    } catch (e) {
      if (attempt === 2) return { ok: false, error: (e as Error).message };
      await sleep(0.3 * (attempt + 1) * 1000);
    }
  }
  return { ok: false, error: "push-retry-exhausted" };
}

/** Push to a single LINE user (e.g. a maid bound via line_user_id). */
export async function pushToLineUser(
  lineUserId: string,
  text: string,
): Promise<LineSendResult> {
  return pushRaw(lineUserId, text);
}

/**
 * Send to a role-channel. Prefers the Messaging API (group id in env); falls
 * back to legacy LINE Notify during the OA transition. Dev w/o any config →
 * logs + returns {ok:false} (callers tolerate it; crons stay green).
 */
export async function notifyChannel(
  channel: ChairopsLineChannel,
  text: string,
): Promise<LineSendResult> {
  const groupId = process.env[GROUP_ENV[channel]];
  if (process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN && groupId) {
    const r = await pushRaw(groupId, text);
    if (r.ok) return r;
  }
  // Transition fallback — legacy Notify (EOL, but works until tokens land).
  const legacy = await sendLineNotify(channel, text);
  if (legacy.ok) return { ok: true, via: "notify" };

  if (process.env.NODE_ENV !== "production") {
    console.log(`[chairops-line dev · ${channel}] ${text}`);
  }
  return { ok: false, error: "no-line-channel-configured" };
}
