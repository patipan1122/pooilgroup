// Facebook redirects here with ?code & ?state.  We verify state, swap the
// code for a user token, upgrade to long-lived, then fetch the page list
// and stash it on a short-lived signed cookie so the picker UI can read it
// without us persisting anything sensitive in the DB.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import {
  exchangeCodeForToken,
  upgradeToLongLived,
  listUserPages,
  verifyState,
} from "@/lib/inbox/facebook-oauth";
import { encryptToken } from "@/lib/inbox/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOKIE_NAME = "inbox_fb_oauth_pages";

function redirectUriFrom(req: Request): string {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return `${proto}://${host}/api/inbox/facebook-oauth/callback`;
}

function appRoot(req: Request): string {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return `${proto}://${host}`;
}

function fail(req: Request, message: string): NextResponse {
  // Strip anything that LOOKS like an OAuth access token before bouncing back
  // to a URL that ends up in browser history / referer / server access logs
  // (audit FB-002).  Provider error bodies sometimes echo our request URL,
  // and the request URL carries client_secret + code in querystring.
  const sanitized = message
    .replace(/EAA[A-Za-z0-9_-]{20,}/g, "[FB_TOKEN]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED]")
    .replace(/code=[A-Za-z0-9_-]{10,}/gi, "code=[REDACTED]");
  const url = new URL("/inbox/settings/channels", appRoot(req));
  url.searchParams.set("fb_error", sanitized.slice(0, 200));
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const fbError = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (fbError) return fail(req, `Facebook ปฏิเสธ: ${fbError}`);
  if (!code || !state) return fail(req, "callback ขาด code/state");

  // Verify the state token matches THIS user's session — protects against
  // CSRF + replay by anyone forging a callback.
  const verified = verifyState(state);
  if (!verified || verified.userId !== session.user.id) {
    return fail(req, "state ไม่ถูกต้องหรือหมดอายุ · ลองใหม่");
  }

  let userToken: string;
  try {
    const codeResp = await exchangeCodeForToken({
      code,
      redirectUri: redirectUriFrom(req),
    });
    const long = await upgradeToLongLived({ shortLivedToken: codeResp.access_token });
    userToken = long.access_token;
  } catch (e) {
    // Server-side log keeps the full Facebook error message for debugging;
    // the user-facing redirect gets a generic line so the raw FB response
    // (which may echo our request including secrets) never lands in browser
    // history or referer headers (audit FB-002).
    console.error("[fb-oauth] token exchange failed", (e as Error).message);
    return fail(req, "Facebook token exchange ไม่สำเร็จ · ตรวจ Vercel logs");
  }

  let pages: Awaited<ReturnType<typeof listUserPages>>;
  try {
    pages = await listUserPages({ userAccessToken: userToken });
  } catch (e) {
    console.error("[fb-oauth] list pages failed", (e as Error).message);
    return fail(req, "เรียก list pages ไม่สำเร็จ · ตรวจ Vercel logs");
  }

  if (pages.length === 0) {
    return fail(req, "บัญชีนี้ไม่มีเพจที่จัดการได้");
  }

  // Pack the page list onto a short-lived signed cookie so the picker page
  // can render it.  Tokens get encrypted (with the same channel-crypto key)
  // so a leaked cookie alone isn't enough to message customers.
  const cookieBody = {
    ts: Date.now(),
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category ?? null,
      // store the per-page token already encrypted — same scheme used at the
      // channel level so we never have plaintext bytes lying around.
      accessTokenEnc: encryptToken(p.access_token),
    })),
  };
  const body = Buffer.from(JSON.stringify(cookieBody)).toString("base64url");
  const key =
    process.env.OAUTH_STATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "fallback-dev-only";
  const mac = crypto.createHmac("sha256", key).update(body).digest("base64url");
  const cookieValue = `${body}.${mac}`;

  const dest = new URL("/inbox/settings/channels/facebook-import", appRoot(req));
  const resp = NextResponse.redirect(dest);
  resp.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60, // 15 minutes — user has that long to pick + submit
  });
  return resp;
}
