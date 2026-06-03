// GET /api/chairops/drive/oauth/callback
// Google redirects here after consent. We verify the session (CEO+ADMIN) and
// the CSRF state cookie, exchange the code for a refresh token, store it
// encrypted, ensure the root backup folder, then bounce back to the settings
// page. CEO 2026-06-03.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/chairops/audit/log";
import {
  exchangeCodeForTokens,
  encryptToken,
  ensureFolder,
} from "@/lib/chairops/storage/drive";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/chairops/storage/drive-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(origin: string, params: Record<string, string>) {
  const u = new URL("/chairops/settings/drive", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthErr = request.nextUrl.searchParams.get("error");

  if (oauthErr) return back(origin, { error: oauthErr });

  // session + role
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));
  if (rankOf(session.user.role) < rankOf(ChairopsUserRole.ADMIN)) {
    return back(origin, { error: "forbidden" });
  }

  // CSRF: state must match the nonce we set at connect-start
  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return back(origin, { error: "bad_state" });
  }

  const tokens = await exchangeCodeForTokens(code, await callbackRedirectUri());
  if (!tokens) return back(origin, { error: "exchange_failed" });

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
    return back(origin, { error: "store_failed" });
  }

  return back(origin, { connected: "1" });
}
