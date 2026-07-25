// RentSpace tenant portal — LINE OA "Talaytown พื้นที่เช่า" (@062xvift)
// แยก OA/แยกโควตา push จาก OA อื่น (RULE J). สองงาน:
//   1) Messaging API — push "มีการวางบิลแล้ว" หาผู้เช่า
//   2) LINE Login (OAuth) — ผู้เช่าเชื่อม LINE → ได้ userId จริง → push ได้ (userId เดียวกับ Messaging เพราะ provider เดียวกัน)
// env (namespace): RENTSPACE_LINE_CHANNEL_ACCESS_TOKEN / _CHANNEL_SECRET / _LOGIN_CHANNEL_ID / _LOGIN_CHANNEL_SECRET
// dormant-safe: ถ้ายังไม่ใส่กุญแจ → push คืน {skipped:true} · authorize คืน not-configured (ไม่ throw)
import { createHmac, timingSafeEqual } from "crypto";
import { getBaseUrl } from "@/lib/utils/base-url";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const PROFILE_URL = "https://api.line.me/v2/profile";

export const RENTSPACE_LINE_CALLBACK_PATH = "/rentspace/line/callback";

/** redirect_uri ต้องตรงเป๊ะกับ Callback URL ที่ตั้งใน LINE Login channel → ผูกกับโดเมน env (pooilgroup.com) */
export function rentspaceLineRedirectUri(): string {
  return getBaseUrl().replace(/\/$/, "") + RENTSPACE_LINE_CALLBACK_PATH;
}

export function rentspaceLineConfigured(): boolean {
  return !!(process.env.RENTSPACE_LINE_LOGIN_CHANNEL_ID && process.env.RENTSPACE_LINE_LOGIN_CHANNEL_SECRET);
}

// ───────── push (Messaging API) ─────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LinePushResult = { ok: boolean; skipped?: boolean; error?: string };

export async function rentspacePushMessages(to: string, messages: Array<Record<string, unknown>>): Promise<LinePushResult> {
  const token = process.env.RENTSPACE_LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, skipped: true, error: "no-token" }; // หลับรอจนกว่าจะใส่กุญแจ
  if (!to) return { ok: false, error: "no-recipient" };
  const body = JSON.stringify({ to, messages });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
      });
      if (res.ok) return { ok: true };
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Math.min(3000, ra > 0 ? ra * 1000 : 300 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: `line ${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }
  return { ok: false, error: "push-failed-after-retries" };
}

export async function rentspacePushText(to: string, text: string): Promise<LinePushResult> {
  return rentspacePushMessages(to, [{ type: "text", text: text.slice(0, 5000) }]);
}

// ───────── reply (Messaging API · ฟรี ไม่กินโควตา · ใช้ตอบ chatbot) ─────────
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

export async function rentspaceReply(replyToken: string, messages: Array<Record<string, unknown>>): Promise<LinePushResult> {
  const token = process.env.RENTSPACE_LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, skipped: true, error: "no-token" };
  if (!replyToken) return { ok: false, error: "no-reply-token" };
  try {
    const res = await fetch(REPLY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `line ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch {
    return { ok: false, error: "reply-failed" };
  }
}

export async function rentspaceReplyText(replyToken: string, text: string): Promise<LinePushResult> {
  return rentspaceReply(replyToken, [{ type: "text", text: text.slice(0, 5000) }]);
}

// ───────── OAuth (LINE Login) ─────────
export function rentspaceLineAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.RENTSPACE_LINE_LOGIN_CHANNEL_ID ?? "",
    redirect_uri: rentspaceLineRedirectUri(),
    state,
    scope: "profile openid",
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

export async function rentspaceLineExchangeCode(code: string): Promise<{ accessToken: string } | null> {
  const cid = process.env.RENTSPACE_LINE_LOGIN_CHANNEL_ID;
  const secret = process.env.RENTSPACE_LINE_LOGIN_CHANNEL_SECRET;
  if (!cid || !secret) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: rentspaceLineRedirectUri(),
      client_id: cid,
      client_secret: secret,
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string };
  return j.access_token ? { accessToken: j.access_token } : null;
}

export async function rentspaceLineProfile(accessToken: string): Promise<{ userId: string; displayName: string } | null> {
  const res = await fetch(PROFILE_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const j = (await res.json()) as { userId?: string; displayName?: string };
  return j.userId ? { userId: j.userId, displayName: j.displayName ?? "" } : null;
}

// ───────── state (CSRF + พก portalToken · ไม่ใช้ cookie เพราะ LINE webview ทิ้ง cookie) ─────────
function stateSecret(): string {
  return process.env.RENTSPACE_LINE_LOGIN_CHANNEL_SECRET || process.env.JWT_SECRET || "rentspace-portal-fallback";
}
export function signPortalState(portalToken: string): string {
  const payload = Buffer.from(JSON.stringify({ t: portalToken, x: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function verifyPortalState(state: string): string | null {
  const [payload, sig] = (state || "").split(".");
  if (!payload || !sig) return null;
  const expect = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  try {
    const { t, x } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { t?: string; x?: number };
    if (typeof t !== "string" || !t) return null;
    if (typeof x === "number" && Date.now() - x > 15 * 60_000) return null; // state อายุ 15 นาที
    return t;
  } catch {
    return null;
  }
}

// ───────── webhook signature (เผื่ออนาคต) ─────────
export function verifyRentspaceLineSignature(bodyRaw: string, signature: string | null): boolean {
  const secret = process.env.RENTSPACE_LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expect = createHmac("sha256", secret).update(bodyRaw).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expect));
  } catch {
    return false;
  }
}
