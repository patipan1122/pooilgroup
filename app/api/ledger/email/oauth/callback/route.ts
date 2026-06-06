// GET /api/ledger/email/oauth/callback
// Google redirects here after Gmail consent for LedgerLine. Stores the encrypted
// refresh token as a row in public.ledger_email_connection (multi-mailbox,
// company-scoped — D1). Reuses the same Google OAuth app as ChairOps/Drive.
// The target companyId travels in the state cookie (`nonce:companyId`).

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForTokens, encryptToken } from "@/lib/ledger/gmail";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/ledger/gmail-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_ROLES = ["super_admin", "org_admin", "admin"];

function back(origin: string, companyId: string | null, params: Record<string, string>) {
  const u = new URL("/ledger/settings/google", origin);
  if (companyId) u.searchParams.set("company", companyId);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthErr = request.nextUrl.searchParams.get("error");

  const jar = await cookies();
  const cookieVal = jar.get(OAUTH_STATE_COOKIE)?.value ?? "";
  jar.delete(OAUTH_STATE_COOKIE);
  const [expectedNonce, cookieCompanyId] = cookieVal.split(":");
  const companyId = cookieCompanyId || null;

  if (oauthErr) return back(origin, companyId, { error: oauthErr });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return back(origin, companyId, { error: "forbidden" });
  }

  // CSRF: state param must match the nonce in the cookie; companyId must be present.
  if (!code || !state || !expectedNonce || state !== expectedNonce || !companyId) {
    return back(origin, companyId, { error: "bad_state" });
  }

  const tokens = await exchangeCodeForTokens(code, await callbackRedirectUri());
  if (!tokens) return back(origin, companyId, { error: "exchange_failed" });

  // The connected Gmail address is both display + the per-company unique key.
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
    // best-effort
  }
  if (!gmailEmail) return back(origin, companyId, { error: "no_email" });

  try {
    await prisma.ledgerEmailConnection.upsert({
      where: {
        orgId_companyId_gmailEmail: {
          orgId: session.user.org_id,
          companyId,
          gmailEmail,
        },
      },
      create: {
        orgId: session.user.org_id,
        companyId,
        gmailEmail,
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scope,
        connectedById: session.user.id,
      },
      update: {
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scope,
        connectedById: session.user.id,
        active: true,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[ledger:email] store connection failed", e);
    return back(origin, companyId, { error: "store_failed" });
  }

  return back(origin, companyId, { connected: "1", email: gmailEmail });
}
