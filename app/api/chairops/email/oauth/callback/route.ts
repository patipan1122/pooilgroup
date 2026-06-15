// GET /api/chairops/email/oauth/callback
// Google redirects here after Gmail consent. Mirrors the Drive callback pattern.
// Stores encrypted refresh token in ChairopsGmailConnection. CEO 2026-06-05.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/chairops/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/chairops/audit/log";
import {
  exchangeCodeForTokens,
  encryptToken,
} from "@/lib/chairops/email/gmail";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/chairops/email/gmail-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(origin: string, params: Record<string, string>) {
  const u = new URL("/chairops/settings/email", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthErr = request.nextUrl.searchParams.get("error");

  if (oauthErr) return back(origin, { error: oauthErr });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));
  // เชื่อม Gmail = โครงสร้างหลังบ้าน → เฉพาะ Pool super_admin (CEO 2026-06-15)
  if (!isSuperAdmin(session.poolUser.role)) {
    return back(origin, { error: "forbidden" });
  }

  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return back(origin, { error: "bad_state" });
  }

  const tokens = await exchangeCodeForTokens(code, await callbackRedirectUri());
  if (!tokens) return back(origin, { error: "exchange_failed" });

  // Fetch the Gmail address so we can display it in the settings UI
  let gmailEmail: string | null = null;
  try {
    const profileRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as { emailAddress?: string };
      gmailEmail = profile.emailAddress ?? null;
    }
  } catch {
    // best-effort; email display is cosmetic
  }

  try {
    await prisma.chairopsGmailConnection.upsert({
      where: { orgId: session.user.orgId },
      create: {
        orgId: session.user.orgId,
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        gmailEmail,
        scopes: tokens.scope,
        connectedById: session.user.id,
      },
      update: {
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        gmailEmail,
        scopes: tokens.scope,
        connectedById: session.user.id,
        updatedAt: new Date(),
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "gmail.connect",
      entity: "ChairopsGmailConnection",
      entityId: session.user.orgId,
      newValue: { gmailEmail, scope: tokens.scope },
    });
  } catch (e) {
    console.error("[chairops gmail] store connection failed", e);
    return back(origin, { error: "store_failed" });
  }

  return back(origin, { connected: "1" });
}
