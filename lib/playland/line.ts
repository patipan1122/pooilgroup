// Playland — LINE Messaging API push (operational alerts only, e.g. device offline).
//
// Uses PLAYLAND-namespaced env per RULE J (CEO 2026-06-08): never share a channel
// across modules, even if the underlying LINE OA happens to be the same one —
// each program gets its own env var name so rotating/adding one never silently
// breaks another program's integration.
//   PLAYLAND_LINE_CHANNEL_ACCESS_TOKEN — Messaging API push auth
//   PLAYLAND_LINE_ALERT_TARGET_ID      — userId or groupId that receives alerts
//
// Mirrors lib/clawhub/line.ts (same endpoint, same bounded retry, never-throw
// so a cron run stays green even if LINE is down or not configured yet).

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

export interface LineSendResult {
  ok: boolean;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** ยังไม่ได้ตั้งค่า LINE ของ Playland → คืน false เงียบ ๆ (ไม่ throw) ให้ cron ทำงานต่อได้ */
export function playlandLineConfigured(): boolean {
  return Boolean(process.env.PLAYLAND_LINE_CHANNEL_ACCESS_TOKEN && process.env.PLAYLAND_LINE_ALERT_TARGET_ID);
}

export async function pushPlaylandLineAlert(text: string): Promise<LineSendResult> {
  const token = process.env.PLAYLAND_LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.PLAYLAND_LINE_ALERT_TARGET_ID;
  if (!token || !to) return { ok: false, error: "no-token" };

  const body = JSON.stringify({ to, messages: [{ type: "text", text }] });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return { ok: true };
      if (r.status === 429 || r.status >= 500) {
        if (attempt < 2) {
          await sleep(300 * (attempt + 1));
          continue;
        }
      }
      const txt = await r.text().catch(() => "");
      return { ok: false, error: `LINE ${r.status}: ${txt.slice(0, 200)}` };
    } catch (e) {
      if (attempt === 2) return { ok: false, error: e instanceof Error ? e.message : "unknown" };
      await sleep(300 * (attempt + 1));
    }
  }
  return { ok: false, error: "retry-exhausted" };
}
