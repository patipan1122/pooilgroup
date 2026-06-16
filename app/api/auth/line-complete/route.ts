// Companion to /api/auth/line-login — consumes the short-lived httpOnly
// `ll_pending` cookie set by line-login and 302-redirects the user to the
// Supabase magic-link. The link is NEVER exposed to client JS.

import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const link = req.cookies.get("ll_pending")?.value;
  if (!link) {
    // Cookie missing — the most likely cause is the OAuth fallback path
    // (line-callback internal fetch to line-login) failing to forward the
    // Set-Cookie header to the user's browser. Surface explicitly instead of
    // silently bouncing through /liff/status → /login.
    const u = new URL("/auth/line-error", req.url);
    u.searchParams.set("reason", "ll-pending-missing");
    u.searchParams.set(
      "detail",
      "magic-link cookie not delivered to browser",
    );
    return NextResponse.redirect(u, 303);
  }
  // Strict allowlist: only Supabase auth verify URLs may be redirected to.
  try {
    const parsed = new URL(link);
    const allowedHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : "";
    if (!allowedHost || parsed.host !== allowedHost) {
      const u = new URL("/auth/line-error", req.url);
      u.searchParams.set("reason", "ll-pending-bad-host");
      u.searchParams.set("detail", `host=${parsed.host} expected=${allowedHost}`);
      return NextResponse.redirect(u, 303);
    }
  } catch {
    const u = new URL("/auth/line-error", req.url);
    u.searchParams.set("reason", "ll-pending-malformed");
    return NextResponse.redirect(u, 303);
  }
  const res = NextResponse.redirect(link, 303);
  // Clear the pending cookie immediately — single use.
  res.cookies.set("ll_pending", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/line-complete",
    maxAge: 0,
  });
  // Issue the set-session ticket HERE for the LIFF path (2026-06-16 fix).
  // /api/auth/set-session (Wave-2 audit SEC P0 #5) refuses to write the session
  // cookies unless the request carries `line_set_session_ticket` — but only
  // /auth/line-start (the OAuth FALLBACK) was setting it. The PRIMARY LIFF flow
  // (line-login → here → Supabase magic-link → /auth/liff-complete → set-session)
  // never passed through line-start, so set-session always 403'd → maids could
  // log in via the link but never actually got a session → bounced to /login.
  // Reaching this route already proves a server-verified LINE id_token (line-login
  // set `ll_pending` only after verifying it), so issuing the ticket here is as
  // trustworthy as line-start. Single-use; set-session clears it on success.
  const setSessionTicket = randomBytes(32).toString("hex");
  res.cookies.set("line_set_session_ticket", setSessionTicket, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
