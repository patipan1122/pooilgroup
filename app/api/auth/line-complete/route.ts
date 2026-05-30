// Companion to /api/auth/line-login — consumes the short-lived httpOnly
// `ll_pending` cookie set by line-login and 302-redirects the user to the
// Supabase magic-link. The link is NEVER exposed to client JS.

import { type NextRequest, NextResponse } from "next/server";

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
  return res;
}
