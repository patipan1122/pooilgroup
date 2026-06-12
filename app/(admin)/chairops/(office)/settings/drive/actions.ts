"use server";

// ChairOps · Google Drive connect/disconnect (CEO 2026-06-03).
// CEO+ADMIN only. startDriveConnect() returns the Google consent URL (the
// client redirects to it); the callback route finishes the handshake. A
// random nonce in an httpOnly cookie guards the OAuth round-trip (CSRF).

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/chairops/auth/session";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/chairops/audit/log";
import { isDriveOAuthConfigured, buildConsentUrl } from "@/lib/chairops/storage/drive";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/chairops/storage/drive-oauth";

export async function startDriveConnect(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  if (!isSuperAdmin(session.poolUser.role)) {
    return { ok: false, error: "เฉพาะเจ้าของระบบ (super admin) เชื่อมต่อได้" };
  }
  if (!isDriveOAuthConfigured()) {
    return {
      ok: false,
      error:
        "ยังไม่ได้ตั้งค่า Google OAuth (GOOGLE_OAUTH_CLIENT_ID / SECRET) ใน Vercel",
    };
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  const url = buildConsentUrl(await callbackRedirectUri(), nonce);
  return { ok: true, url };
}

export async function disconnectDrive(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  if (!isSuperAdmin(session.poolUser.role)) {
    return { ok: false, error: "เฉพาะเจ้าของระบบ (super admin) ยกเลิกการเชื่อมต่อได้" };
  }
  try {
    await prisma.chairopsDriveConnection.deleteMany({
      where: { orgId: session.user.orgId },
    });
    await writeAudit({
      userId: session.user.id,
      action: "drive.disconnect",
      entity: "ChairopsDriveConnection",
      entityId: session.user.orgId,
    });
    revalidatePath("/chairops/settings/drive");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ" };
  }
}
