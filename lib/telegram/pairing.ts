// Telegram account-link pairing — "/start <token>" flow.
// ────────────────────────────────────────────────────────────────────
// Lets any Pooilgroup user connect their OWN Telegram account to their
// user row (users.telegram_user_id / telegram_chat_id) without an admin
// manually typing a chat id in from @userinfobot (the only path that
// existed before this — see app/(admin)/settings/notifications/form.tsx's
// "ดู Chat ID ได้ที่ @userinfobot" hint).
//
// Storage: the `telegram_pairing_tokens` table (prisma/migrations/
// 002_core_extensions.sql) — already live in the DB, never used by any
// application code until now. Zero new migration needed: this module is
// the first real consumer of a table that was built ahead of need.
//
// Token format mirrors lib/auth/invite.ts's makeInviteToken() (same
// crypto.getRandomValues → hex pattern) — reusing the established
// "random token" idiom instead of inventing a new one.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function makeConnectToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CreatedPairingToken {
  token: string;
  expiresAt: Date;
  /** `https://t.me/<bot>?start=<token>` when TELEGRAM_BOT_USERNAME is
   *  configured, else null — caller falls back to showing the raw token
   *  with manual "/start <token>" instructions. */
  deepLink: string | null;
}

/**
 * Mint a fresh connect token for `userId`. Any previous UNUSED token for
 * this same user is deleted first (regenerating a link should invalidate
 * the old one rather than leaving two valid tokens floating around).
 */
export async function createPairingToken(params: {
  orgId: string;
  userId: string;
}): Promise<CreatedPairingToken> {
  await prisma.telegramPairingToken.deleteMany({
    where: { userId: params.userId, usedAt: null },
  });

  const token = makeConnectToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.telegramPairingToken.create({
    data: {
      orgId: params.orgId,
      userId: params.userId,
      token,
      expiresAt,
    },
  });

  return { token, expiresAt, deepLink: buildTelegramDeepLink(token) };
}

export interface ResolvedPairingToken {
  orgId: string;
  userId: string;
}

/**
 * Resolve + CONSUME a connect token (one-time use). Returns null when the
 * token doesn't exist, already got used, or expired — callers must treat
 * all three cases the same way (generic "link no longer valid" message),
 * never leaking which one it was.
 */
export async function resolvePairingToken(
  token: string,
): Promise<ResolvedPairingToken | null> {
  const row = await prisma.telegramPairingToken.findUnique({
    where: { token },
    select: { orgId: true, userId: true, usedAt: true, expiresAt: true },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Mark used immediately (before the caller links the chat id) so a
  // double-fired Telegram webhook retry can't consume the same token twice.
  await prisma.telegramPairingToken.update({
    where: { token },
    data: { usedAt: new Date() },
  });

  return { orgId: row.orgId, userId: row.userId };
}

/** `t.me` deep link, or null if TELEGRAM_BOT_USERNAME isn't configured yet
 *  (feature still works without it — the settings page shows the raw
 *  token + manual "/start <token>" instructions instead). */
export function buildTelegramDeepLink(token: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim();
  if (!username) return null;
  const handle = username.replace(/^@/, "");
  return `https://t.me/${handle}?start=${token}`;
}
