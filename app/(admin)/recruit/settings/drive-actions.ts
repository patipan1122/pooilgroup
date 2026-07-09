"use server";

// Recruit · connect the org's Google Drive from INSIDE the Recruit program
// (so HR/CEO never has to go into ChairOps). It's ONE company-wide Google
// connection (stored per-org, shared by ChairOps/Ledger/Recruit) — this just
// starts the same OAuth handshake and sets a return cookie so the callback
// bounces back to the Recruit settings page.

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import {
  isDriveOAuthConfigured,
  buildConsentUrl,
} from "@/lib/chairops/storage/drive";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_RETURN_COOKIE,
  callbackRedirectUri,
} from "@/lib/chairops/storage/drive-oauth";

const RETURN_PATH = "/recruit/settings";

export async function startRecruitDriveConnect(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  // Connecting Drive touches shared back-office storage → super admin only.
  if (!isSuperAdmin(session.user.role)) {
    return { ok: false, error: "เฉพาะเจ้าของระบบ (super admin) เชื่อมต่อได้" };
  }
  if (!isDriveOAuthConfigured()) {
    return {
      ok: false,
      error: "ยังไม่ได้ตั้งค่า Google OAuth (GOOGLE_OAUTH_CLIENT_ID / SECRET) ใน Vercel",
    };
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  jar.set(OAUTH_STATE_COOKIE, nonce, opts);
  jar.set(OAUTH_RETURN_COOKIE, RETURN_PATH, opts);
  return { ok: true, url: buildConsentUrl(await callbackRedirectUri(), nonce) };
}
