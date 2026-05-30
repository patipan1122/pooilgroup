// LINE OAuth callback — receives auth code from access.line.me, exchanges
// for id_token via api.line.me/oauth2/v2.1/token, then forwards to the
// existing /api/auth/line-login flow (which already verifies the id_token
// against LINE's verify endpoint, resolves user, mints Supabase magic link).
//
// Pre-req env: CHAIROPS_LINE_LOGIN_CHANNEL_SECRET — secret of the LINE Login
// channel (same channel that owns NEXT_PUBLIC_LIFF_ID). Different from
// CHAIROPS_LINE_CHANNEL_SECRET which is the Messaging API channel secret.

import { type NextRequest, NextResponse } from "next/server";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginResult = {
  ready?: boolean;
  completeUrl?: string;
  matched?: boolean;
  needsLink?: boolean;
  lineUserId?: string;
  hint?: string | null;
  error?: string;
};

function clearOauthCookies(res: NextResponse) {
  res.cookies.delete("line_oauth_state");
  res.cookies.delete("line_oauth_nonce");
  res.cookies.delete("line_oauth_next");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  const baseUrl = getRequestBaseUrl(req);
  const cookieState = req.cookies.get("line_oauth_state")?.value;
  const cookieNext = req.cookies.get("line_oauth_next")?.value ?? "/chairops/m";

  function fail(reason: string, detail = ""): NextResponse {
    const u = new URL(`${baseUrl}/auth/line-error`);
    u.searchParams.set("reason", reason);
    if (detail) u.searchParams.set("detail", detail.slice(0, 280));
    const res = NextResponse.redirect(u);
    clearOauthCookies(res);
    return res;
  }

  if (errorParam) {
    return fail("line-denied", `${errorParam}: ${errorDesc ?? ""}`);
  }
  if (!code || !state) {
    return fail("missing-code", `code=${!!code} state=${!!state}`);
  }
  if (!cookieState || cookieState !== state) {
    return fail("state-mismatch", "state cookie missing or differs");
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const channelId = liffId?.split("-")[0];
  const channelSecret = process.env.CHAIROPS_LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) {
    return fail(
      "server-config",
      `channelId=${!!channelId} secret=${!!channelSecret}`,
    );
  }

  let idToken: string;
  try {
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${baseUrl}/auth/line-callback`,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return fail("token-exchange", `${tokenRes.status}: ${body.slice(0, 200)}`);
    }
    const tokenJson = (await tokenRes.json()) as { id_token?: string };
    if (!tokenJson.id_token) {
      return fail("no-id-token", JSON.stringify(tokenJson).slice(0, 200));
    }
    idToken = tokenJson.id_token;
  } catch (e) {
    return fail("token-fetch", e instanceof Error ? e.message : "unknown");
  }

  let loginJson: LoginResult;
  // line-login sets a short-lived httpOnly cookie `ll_pending` (path-scoped
  // to /api/auth/line-complete) holding the Supabase magic link. Because we
  // call line-login via server-side fetch, that Set-Cookie header is captured
  // on the INTERNAL response and never reaches the user's browser. We must
  // forward it explicitly on the redirect we return; otherwise line-complete
  // sees no cookie and bounces to /liff/status (the symptom CEO hit).
  let forwardSetCookies: string[] = [];
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/line-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, redirectTo: cookieNext }),
    });
    type HeadersWithGetSetCookie = Headers & { getSetCookie?: () => string[] };
    const h = loginRes.headers as HeadersWithGetSetCookie;
    if (typeof h.getSetCookie === "function") {
      forwardSetCookies = h.getSetCookie();
    } else {
      const raw = loginRes.headers.get("set-cookie");
      if (raw) forwardSetCookies = [raw];
    }
    loginJson = (await loginRes.json()) as LoginResult;
    if (!loginRes.ok) {
      return fail("login-api", `${loginRes.status}: ${loginJson?.error ?? ""}`);
    }
  } catch (e) {
    return fail("login-fetch", e instanceof Error ? e.message : "unknown");
  }

  if (loginJson.ready && loginJson.completeUrl) {
    const target = loginJson.completeUrl.startsWith("http")
      ? loginJson.completeUrl
      : `${baseUrl}${loginJson.completeUrl}`;
    const res = NextResponse.redirect(target);
    for (const sc of forwardSetCookies) {
      res.headers.append("Set-Cookie", sc);
    }
    clearOauthCookies(res);
    return res;
  }

  if (loginJson.needsLink && loginJson.lineUserId) {
    const u = new URL(`${baseUrl}/auth/line-pending`);
    u.searchParams.set("lineUserId", loginJson.lineUserId);
    if (loginJson.hint) u.searchParams.set("name", loginJson.hint);
    const res = NextResponse.redirect(u);
    clearOauthCookies(res);
    return res;
  }

  return fail("unexpected", JSON.stringify(loginJson).slice(0, 200));
}
