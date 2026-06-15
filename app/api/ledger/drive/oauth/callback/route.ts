// GET /api/ledger/drive/oauth/callback
// Google redirects here after Drive consent started from LedgerLine settings.
// Drive is org-level (shared): we upsert the SAME ChairopsDriveConnection that
// lib/ledger/drive.ts already reads when archiving receipts. Reuses the ChairOps
// Drive client (same Google app, same crypto). Then back to /ledger/settings/google.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForTokens, encryptToken } from "@/lib/chairops/storage/drive";
import { DRIVE_OAUTH_STATE_COOKIE, driveCallbackRedirectUri } from "@/lib/ledger/drive-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const cookieVal = jar.get(DRIVE_OAUTH_STATE_COOKIE)?.value ?? "";
  jar.delete(DRIVE_OAUTH_STATE_COOKIE);
  const [expectedNonce, cookieCompanyId] = cookieVal.split(":");
  const companyId = cookieCompanyId || null;

  if (oauthErr) return back(origin, companyId, { error: oauthErr });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));
  // เชื่อม Google Drive = โครงสร้างหลังบ้าน → เฉพาะ super_admin (CEO 2026-06-15)
  if (!isSuperAdmin(session.user.role)) {
    return back(origin, companyId, { error: "forbidden" });
  }

  if (!code || !state || !expectedNonce || state !== expectedNonce) {
    return back(origin, companyId, { error: "bad_state" });
  }

  const tokens = await exchangeCodeForTokens(code, await driveCallbackRedirectUri());
  if (!tokens) return back(origin, companyId, { error: "exchange_failed" });

  try {
    await prisma.chairopsDriveConnection.upsert({
      where: { orgId: session.user.org_id },
      create: {
        orgId: session.user.org_id,
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scope,
        connectedById: session.user.id,
      },
      update: {
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scope,
        connectedById: session.user.id,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[ledger:drive] store connection failed", e);
    return back(origin, companyId, { error: "store_failed" });
  }

  return back(origin, companyId, { drive_connected: "1" });
}
