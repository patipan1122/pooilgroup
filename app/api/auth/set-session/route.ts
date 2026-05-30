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

export async function POST(req: NextRequest) {
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
  return NextResponse.json({ ok: true, userId: data.session.user.id });
}
