// Direct LINE OAuth — fallback when LIFF SDK fails to init (iOS WKWebView
// "TypeError: Load failed" issue). Skips the LIFF SDK entirely and runs the
// standard OAuth 2.1 authorization-code flow against access.line.me.
//
// Flow:
//   /auth/line-start?next=/chairops/m
//     → set state/nonce/next cookies (10 min)
//     → 302 to access.line.me/oauth2/v2.1/authorize
//   LINE prompts user → consent
//     → 302 back to /auth/line-callback?code=...&state=...
//   (see app/auth/line-callback/route.ts)

import { type NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeRelPath(p: string | null): string {
  if (!p || !p.startsWith("/") || p.startsWith("//")) return "/chairops/m";
  return p;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = safeRelPath(url.searchParams.get("next"));

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const channelId = liffId?.split("-")[0];
  if (!channelId) {
    return NextResponse.json(
      { error: "LINE channel not configured (NEXT_PUBLIC_LIFF_ID missing)" },
      { status: 500 },
    );
  }

  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  // Wave-2 audit SEC P0 #5: bind /api/auth/set-session to a server-issued
  // unforgeable ticket so an attacker who steals a refresh_token cannot
  // simply POST to set-session and inherit the victim's cookie. Set here at
  // OAuth start · validated by set-session · single-use · cleared on use.
  const setSessionTicket = randomBytes(32).toString("hex");
  const baseUrl = getRequestBaseUrl(req);
  const callbackUrl = `${baseUrl}/auth/line-callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: callbackUrl,
    state,
    nonce,
    scope: "openid profile",
  });

  const authorizeUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  const res = NextResponse.redirect(authorizeUrl);
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10,
  };
  res.cookies.set("line_oauth_state", state, cookieOpts);
  res.cookies.set("line_oauth_nonce", nonce, cookieOpts);
  res.cookies.set("line_oauth_next", next, cookieOpts);
  res.cookies.set("line_set_session_ticket", setSessionTicket, cookieOpts);
  return res;
}
