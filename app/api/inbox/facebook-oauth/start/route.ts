// Kick off the Facebook OAuth flow.  Admin clicks "เชื่อม Facebook" → hits
// this route → we mint a signed state token tied to their session and 302
// to FB's OAuth dialog.

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { buildOauthUrl, signState } from "@/lib/inbox/facebook-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectUriFrom(req: Request): string {
  // Honour x-forwarded-host so the URL we tell FB matches the public host
  // (Vercel runs behind a proxy).
  const proto =
    req.headers.get("x-forwarded-proto") ||
    new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return `${proto}://${host}/api/inbox/facebook-oauth/callback`;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const state = signState({
    userId: session.user.id,
    nonce: crypto.randomBytes(12).toString("hex"),
    ts: Date.now(),
  });

  const redirectUri = redirectUriFrom(req);
  const dialogUrl = buildOauthUrl({ state, redirectUri });
  return NextResponse.redirect(dialogUrl);
}
