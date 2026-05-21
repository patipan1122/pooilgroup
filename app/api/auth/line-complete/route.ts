// Companion to /api/auth/line-login — consumes the short-lived httpOnly
// `ll_pending` cookie set by line-login and 302-redirects the user to the
// Supabase magic-link. The link is NEVER exposed to client JS.

import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const link = req.cookies.get("ll_pending")?.value;
  if (!link) {
    // Cookie expired or missing — bounce to LIFF page so the user can retry.
    return NextResponse.redirect(new URL("/liff/status", req.url), 303);
  }
  // Strict allowlist: only Supabase auth verify URLs may be redirected to.
  try {
    const parsed = new URL(link);
    const allowedHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : "";
    if (!allowedHost || parsed.host !== allowedHost) {
      return NextResponse.redirect(new URL("/liff/status", req.url), 303);
    }
  } catch {
    return NextResponse.redirect(new URL("/liff/status", req.url), 303);
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
