"use server";

// ChairOps · Gmail connect/disconnect (CEO 2026-06-05).
// CEO+ADMIN only. startGmailConnect() returns the Google consent URL;
// the callback route at /api/chairops/email/oauth/callback finishes the handshake.

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/chairops/auth/session";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/chairops/audit/log";
import { isGmailOAuthConfigured, buildGmailConsentUrl } from "@/lib/chairops/email/gmail";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/chairops/email/gmail-oauth";

export async function startGmailConnect(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  await requireRole(ChairopsUserRole.ADMIN);
  if (!isGmailOAuthConfigured()) {
    return {
      ok: false,
      error: "ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET ใน Vercel",
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
  const url = buildGmailConsentUrl(await callbackRedirectUri(), nonce);
  return { ok: true, url };
}

export async function disconnectGmail(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  try {
    await prisma.chairopsGmailConnection.deleteMany({
      where: { orgId: session.user.orgId },
    });
    await writeAudit({
      userId: session.user.id,
      action: "gmail.disconnect",
      entity: "ChairopsGmailConnection",
      entityId: session.user.orgId,
    });
    revalidatePath("/chairops/settings/email");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ" };
  }
}
