// GET /api/chairops/drive/oauth/callback
// Google redirects here after consent. We verify the session (CEO+ADMIN) and
// the CSRF state cookie, exchange the code for a refresh token, store it
// encrypted, ensure the root backup folder, then bounce back to the settings
// page. CEO 2026-06-03.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/chairops/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/chairops/audit/log";
import {
  exchangeCodeForTokens,
  encryptToken,
  ensureFolder,
} from "@/lib/chairops/storage/drive";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_RETURN_COOKIE,
  safeReturnPath,
  callbackRedirectUri,
} from "@/lib/chairops/storage/drive-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Bounce back to the settings page the connect flow started from (Recruit sets
// a return cookie; ChairOps/Ledger don't → default to the ChairOps page).
function back(origin: string, returnPath: string | null, params: Record<string, string>) {
  const u = new URL(returnPath ?? "/chairops/settings/drive", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthErr = request.nextUrl.searchParams.get("error");

  const jar = await cookies();
  const returnPath = safeReturnPath(jar.get(OAUTH_RETURN_COOKIE)?.value);
  jar.delete(OAUTH_RETURN_COOKIE);

  if (oauthErr) return back(origin, returnPath, { error: oauthErr });

  // session + role
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));
  // เชื่อม Google Drive = โครงสร้างหลังบ้าน → เฉพาะ Pool super_admin (CEO 2026-06-15)
  if (!isSuperAdmin(session.poolUser.role)) {
    return back(origin, returnPath, { error: "forbidden" });
  }

  // CSRF: state must match the nonce we set at connect-start
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return back(origin, returnPath, { error: "bad_state" });
  }

  const tokens = await exchangeCodeForTokens(code, await callbackRedirectUri());
  if (!tokens) return back(origin, returnPath, { error: "exchange_failed" });

  try {
    // ensure the root folder once, up-front, so later uploads are cheap
    let rootFolderId: string | null = null;
    const rootName = "เก้าอี้นวด backup1";
    rootFolderId = await ensureFolder(tokens.accessToken, rootName, null);

    await prisma.chairopsDriveConnection.upsert({
      where: { orgId: session.user.orgId },
      create: {
        orgId: session.user.orgId,
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        rootFolderId,
        rootFolderName: rootName,
        scopes: tokens.scope,
        connectedById: session.user.id,
      },
      update: {
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        rootFolderId,
        scopes: tokens.scope,
        connectedById: session.user.id,
        updatedAt: new Date(),
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "drive.connect",
      entity: "ChairopsDriveConnection",
      entityId: session.user.orgId,
      newValue: { rootFolderId, scope: tokens.scope },
    });
  } catch (e) {
    console.error("[chairops drive] store connection failed", e);
    return back(origin, returnPath, { error: "store_failed" });
  }

  return back(origin, returnPath, { connected: "1" });
}
