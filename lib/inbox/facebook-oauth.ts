// Facebook OAuth helpers for bulk-connecting Page Messenger.
//
// Flow:
//   1. user clicks "เชื่อม Facebook" → server route mints a state token
//      (HMAC-signed cookie with the user's session id + a CSRF nonce) and
//      redirects to FB's OAuth dialog.
//   2. FB redirects to /api/inbox/facebook-oauth/callback?code=...&state=...
//      → we verify state, exchange `code` for a short-lived user token,
//      then upgrade to a long-lived (60-day) token.
//   3. we call /me/accounts to enumerate pages the user admins (incl. their
//      per-page access tokens) and pass that list to the picker UI.
//
// We never persist the user token; only the per-page tokens land in the DB
// (encrypted, same pattern as the manual flow).

import crypto from "node:crypto";

const FB_API = "https://graph.facebook.com/v19.0";
const OAUTH_DIALOG = "https://www.facebook.com/v19.0/dialog/oauth";

const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
].join(",");

function appCreds() {
  const id = process.env.FACEBOOK_APP_ID;
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!id || !secret) {
    throw new Error(
      "ยังไม่ได้ตั้ง FACEBOOK_APP_ID / FACEBOOK_APP_SECRET ใน Vercel env",
    );
  }
  return { id, secret };
}

function stateSigner() {
  // Reuse SUPABASE_SERVICE_ROLE_KEY as the HMAC key — it's already secret +
  // present in prod; saves us from inventing another env variable.
  const key =
    process.env.OAUTH_STATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "fallback-dev-only";
  return key;
}

/** Build a signed state token: base64url(payload) + "." + hmac. */
export function signState(payload: { userId: string; nonce: string; ts: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto
    .createHmac("sha256", stateSigner())
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(
  raw: string,
): { userId: string; nonce: string; ts: number } | null {
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const expected = crypto
    .createHmac("sha256", stateSigner())
    .update(body)
    .digest("base64url");
  // Constant-time compare
  if (
    expected.length !== mac.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    // 15-minute TTL
    if (Date.now() - payload.ts > 15 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Build the OAuth URL the user is redirected to. */
export function buildOauthUrl(opts: {
  state: string;
  redirectUri: string;
}): string {
  const { id } = appCreds();
  const qs = new URLSearchParams({
    client_id: id,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    response_type: "code",
    scope: SCOPES,
  });
  return `${OAUTH_DIALOG}?${qs.toString()}`;
}

/** Exchange a short-lived code → user access token. */
export async function exchangeCodeForToken(opts: {
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string; expires_in?: number }> {
  const { id, secret } = appCreds();
  const qs = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  const resp = await fetch(`${FB_API}/oauth/access_token?${qs.toString()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`FB code exchange ${resp.status}: ${txt.slice(0, 240)}`);
  }
  return (await resp.json()) as { access_token: string; expires_in?: number };
}

/** Upgrade a short-lived user token → long-lived (60-day) user token. */
export async function upgradeToLongLived(opts: {
  shortLivedToken: string;
}): Promise<{ access_token: string; expires_in?: number }> {
  const { id, secret } = appCreds();
  const qs = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: id,
    client_secret: secret,
    fb_exchange_token: opts.shortLivedToken,
  });
  const resp = await fetch(`${FB_API}/oauth/access_token?${qs.toString()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`FB long-lived exchange ${resp.status}: ${txt.slice(0, 240)}`);
  }
  return (await resp.json()) as { access_token: string; expires_in?: number };
}

export interface FbPage {
  id: string;
  name: string;
  /** Long-lived page access token (FB returns these long-lived when the user token is long-lived) */
  access_token: string;
  category?: string;
  tasks?: string[];
}

/** Enumerate all pages the user manages. */
export async function listUserPages(opts: {
  userAccessToken: string;
}): Promise<FbPage[]> {
  const out: FbPage[] = [];
  let url = `${FB_API}/me/accounts?fields=id,name,access_token,category,tasks&limit=200`;
  // Follow `paging.next` until exhausted.  CEO has 40+ pages so one page of
  // results may not cover everything.
  for (let i = 0; i < 10; i++) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.userAccessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`FB list pages ${resp.status}: ${txt.slice(0, 240)}`);
    }
    const data = (await resp.json()) as {
      data: FbPage[];
      paging?: { next?: string };
    };
    out.push(...(data.data ?? []));
    if (!data.paging?.next) break;
    url = data.paging.next;
  }
  return out;
}

/** Subscribe the page to our app's webhook for `messages` events. */
export async function subscribePageWebhook(opts: {
  pageId: string;
  pageAccessToken: string;
}): Promise<void> {
  const resp = await fetch(
    `${FB_API}/${opts.pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.pageAccessToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`FB subscribe page ${resp.status}: ${txt.slice(0, 240)}`);
  }
}
