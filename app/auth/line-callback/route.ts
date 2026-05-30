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
  actionLink?: string;
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

  // Internal call to line-login. We send `x-line-internal: 1` which makes
  // line-login return the Supabase action_link directly in JSON, so we can
  // 303 the user STRAIGHT to Supabase without the ll_pending cookie
  // indirection. The cookie path was iOS-LINE-webview hostile: the Set-Cookie
  // on the internal fetch never reached the user's browser even with explicit
  // forwarding (CEO captured "magic-link cookie not delivered to browser" via
  // the visible diagnostic on /auth/line-error).
  let loginJson: LoginResult;
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/line-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-internal": "1",
      },
      body: JSON.stringify({ idToken, redirectTo: cookieNext }),
    });
    loginJson = (await loginRes.json()) as LoginResult;
    if (!loginRes.ok) {
      return fail("login-api", `${loginRes.status}: ${loginJson?.error ?? ""}`);
    }
  } catch (e) {
    return fail("login-fetch", e instanceof Error ? e.message : "unknown");
  }

  // Direct redirect to the Supabase magic link — no cookie hops.
  if (loginJson.ready && loginJson.actionLink) {
    const res = NextResponse.redirect(loginJson.actionLink, 303);
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
