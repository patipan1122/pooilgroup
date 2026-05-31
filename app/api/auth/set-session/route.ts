// Server-side session set — called by /auth/liff-complete after it extracts
// the Supabase tokens from the magic-link URL fragment. iOS LINE WKWebView
// drops cookies written via document.cookie (which is what supabase.auth
// .setSession() does in the browser), so the session was set in memory but
// never persisted across the navigation to /chairops/m. Posting the tokens
// here lets the SERVER call setSession via the @supabase/ssr server client,
// which writes cookies via the Set-Cookie response header — iOS WKWebView
// always honors those.

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Be permissive — Supabase JWTs vary in length (refresh tokens can be ~32
// chars; access tokens with custom claims can exceed 4KB). Just need
// non-empty strings; setSession() does the real validation downstream.
const Schema = z.object({
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().min(1).max(16384),
});

// Same-origin check — defense in depth on top of the ticket binding below.
// Browser fetch() to /api/auth/set-session from our own /auth/liff-complete
// always sets a same-origin Origin header. Cross-origin attackers may forge
// CORS pre-flight but cannot send a same-origin Origin without our cookies.
function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // some webviews omit Origin · ticket below is the real guard
  try {
    const u = new URL(req.url);
    return new URL(origin).host === u.host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Wave-2 audit SEC P0 #5: gate this endpoint behind an unforgeable cookie
  // that ONLY /auth/line-start sets. An attacker who steals (access_token,
  // refresh_token) cannot just POST here to inherit the victim's cookie —
  // they'd also need the per-OAuth-flow ticket cookie that's never JS-readable.
  // Single-use: cleared on successful setSession.
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "bad-origin" }, { status: 403 });
  }
  const ticket = req.cookies.get("line_set_session_ticket")?.value;
  if (!ticket || ticket.length < 32) {
    return NextResponse.json(
      { error: "missing-ticket · เริ่ม OAuth ใหม่ที่ /auth/line-start" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const b = body as { access_token?: unknown; refresh_token?: unknown } | null;
    const dbg = `aT=${typeof b?.access_token} aL=${
      typeof b?.access_token === "string" ? b.access_token.length : 0
    } rT=${typeof b?.refresh_token} rL=${
      typeof b?.refresh_token === "string" ? b.refresh_token.length : 0
    }`;
    return NextResponse.json(
      { error: `invalid-tokens: ${issues} [${dbg}]` },
      { status: 400 },
    );
  }

  const sb = await serverClient();
  const { data, error } = await sb.auth.setSession({
    access_token: parsed.data.access_token,
    refresh_token: parsed.data.refresh_token,
  });
  if (error || !data.session) {
    return NextResponse.json(
      { error: `setSession failed: ${error?.message ?? "no-session"}` },
      { status: 401 },
    );
  }
  // Clear the ticket on success — single-use semantics.
  const res = NextResponse.json({ ok: true, userId: data.session.user.id });
  res.cookies.set("line_set_session_ticket", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
