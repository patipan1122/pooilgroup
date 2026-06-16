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
import {
  asLineModule,
  loginChannelIdForModule,
  loginSecretForModule,
} from "@/lib/line/channels";

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
  res.cookies.delete("line_oauth_module");
  res.cookies.delete("line_oauth_claim");
  res.cookies.delete("line_oauth_invite");
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
  // Same channel that started the flow (set by line-start). Default = unchanged.
  const lineModule = asLineModule(req.cookies.get("line_oauth_module")?.value);
  // LedgerLine claim/invite token (LIFF-SDK-free bind path for iOS). When present we
  // bind the verified login sub via /api/ledger/invite/accept instead of logging in.
  const cookieClaim = req.cookies.get("line_oauth_claim")?.value;
  // ChairOps onboarding invite token (set by line-start when the LIFF bootstrap
  // fell back to OAuth). Forwarded to line-login so it binds the maid's verified
  // LINE id to the invited user — the OAuth path previously dropped it.
  const cookieInvite = req.cookies.get("line_oauth_invite")?.value;

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

  const channelId = loginChannelIdForModule(lineModule);
  const channelSecret = loginSecretForModule(lineModule);
  if (!channelId || !channelSecret) {
    return fail(
      "server-config",
      `module=${lineModule} channelId=${!!channelId} secret=${!!channelSecret}`,
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

  // LedgerLine CLAIM path (LIFF-SDK-free): we already hold a verified id_token from
  // the OAuth exchange. Bind it via the ledger invite/accept endpoint (which re-verifies
  // against the ledger login channel + sets users.line_login_sub / the member). This is
  // the iOS escape hatch for "liff.init: Load failed". After binding we DON'T return —
  // we FALL THROUGH to the line-login flow below so a FRESH session is minted for the
  // just-bound user. Critical: the LINE webview may hold a STALE non-admin session from
  // earlier failed attempts; the bootstrap reuses it and the admin/edit gates reject the
  // owner. Minting a new (super_admin) session here overwrites that stale cookie.
  if (cookieClaim) {
    try {
      const acceptRes = await fetch(`${baseUrl}/api/ledger/invite/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cookieClaim, idToken }),
      });
      const acceptJson = (await acceptRes.json()) as { ok?: boolean; error?: string };
      if (!acceptRes.ok || !acceptJson.ok) {
        return fail("claim-failed", acceptJson?.error ?? `accept ${acceptRes.status}`);
      }
    } catch (e) {
      return fail("claim-fetch", e instanceof Error ? e.message : "unknown");
    }
    // bind OK → fall through to mint a fresh session (post-login lands on the success page)
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
      body: JSON.stringify({ idToken, redirectTo: cookieClaim ? "/auth/line-claimed" : cookieNext, module: lineModule, invite: cookieInvite || undefined }),
    });
    loginJson = (await loginRes.json()) as LoginResult;
    if (!loginRes.ok) {
      // ลิงก์เชิญใช้ซ้ำ / หมดอายุ / ผูก LINE อื่นไปแล้ว → หน้าอธิบายชัด ๆ ภาษาคน
      // ("ลิงก์เชิญใช้ได้ครั้งเดียว") แทน error ดิบ "login-api · 410: ..." ที่ดูเหมือน crash
      if (cookieInvite && [400, 404, 409, 410].includes(loginRes.status)) {
        return fail("invite-used", loginJson?.error ?? "");
      }
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
