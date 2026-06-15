// GET /api/ledger/email/oauth/callback
// Google redirects here after Gmail consent for LedgerLine. Stores the encrypted
// refresh token as a row in public.ledger_email_connection (multi-mailbox,
// company-scoped — D1). Reuses the same Google OAuth app as ChairOps/Drive.
// The target companyId travels in the state cookie (`nonce:companyId`).

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForTokens, encryptToken, GMAIL_SCOPE } from "@/lib/ledger/gmail";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/ledger/gmail-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(origin: string, companyId: string | null, params: Record<string, string>) {
  const u = new URL("/ledger/settings/google", origin);
  if (companyId) u.searchParams.set("company", companyId);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

/** Resolve the connected Google account's email. userinfo first (standard, needs
 *  the 'email' scope), Gmail profile as fallback. Returns null only if BOTH fail. */
async function resolveConnectedEmail(accessToken: string): Promise<string | null> {
  // 1) OpenID userinfo — the canonical way to read the signed-in account's email.
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) {
      const j = (await r.json()) as { email?: string };
      if (j.email) return j.email;
    } else {
      console.warn("[ledger:email] userinfo failed", r.status, await r.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("[ledger:email] userinfo threw", e);
  }
  // 2) Gmail profile — fallback (needs gmail.readonly).
  try {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) {
      const j = (await r.json()) as { emailAddress?: string };
      if (j.emailAddress) return j.emailAddress;
    } else {
      console.warn("[ledger:email] gmail profile failed", r.status, await r.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("[ledger:email] gmail profile threw", e);
  }
  return null;
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
  // เชื่อม Gmail = โครงสร้างหลังบ้าน → เฉพาะ super_admin (CEO 2026-06-15)
  if (!isSuperAdmin(session.user.role)) {
    return back(origin, companyId, { error: "forbidden" });
  }

  // CSRF: state param must match the nonce in the cookie; companyId must be present.
  if (!code || !state || !expectedNonce || state !== expectedNonce || !companyId) {
    return back(origin, companyId, { error: "bad_state" });
  }

  const tokens = await exchangeCodeForTokens(code, await callbackRedirectUri());
  if (!tokens) return back(origin, companyId, { error: "exchange_failed" });

  // P1#33: verify Google actually granted the gmail.readonly scope.
  // Google may narrow scopes if the user deselects them on the consent screen.
  // An access token without gmail.readonly will fail silently on every API call.
  const grantedScopes = (tokens.scope ?? "").split(" ");
  if (!grantedScopes.includes(GMAIL_SCOPE)) {
    console.warn(
      "[ledger:email] OAuth completed but gmail.readonly scope not granted. " +
        "Granted scopes: " +
        tokens.scope,
    );
    return back(origin, companyId, { error: "missing_gmail_scope" });
  }

  // P1#36: Guard against Google not returning a refresh token (happens when the
  // user already granted consent without prompt=consent, or access_type=offline
  // was missing). Storing an empty token would break future email scans silently.
  if (!tokens.refreshToken || tokens.refreshToken.trim() === "") {
    console.error("[ledger:email] Google did not return a refresh token — user must revoke and re-connect");
    return back(origin, companyId, {
      error: "no_refresh_token",
      hint: "Gmail ไม่คืน refresh token — กรุณาลองใหม่หรือ revoke access ก่อน",
    });
  }

  // The connected Gmail address is both display + the per-company unique key →
  // it MUST resolve. Try the standard OpenID userinfo endpoint first (reliable,
  // needs the 'email' scope we now request), then fall back to the Gmail profile
  // endpoint. Log every failure so a recurring no_email is debuggable.
  const gmailEmail = await resolveConnectedEmail(tokens.accessToken);
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
