// POST /api/telegram/connect — mint a one-time Telegram connect token for
// the CALLING user's own account. Personal action (like
// lib/docuflow/my-signature.ts's saveMySignature) — not admin-gated, every
// signed-in user may connect their own Telegram. Pages that surface the
// button (e.g. /docuflow/settings/telegram, /profile) may themselves be
// gated however they like; this endpoint only ever touches session.user.id.
//
// Returns the deep link when TELEGRAM_BOT_USERNAME is configured, else the
// raw token for a manual "/start <token>" fallback.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createPairingToken } from "@/lib/telegram/pairing";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireSession();

  const { token, expiresAt, deepLink } = await createPairingToken({
    orgId: session.user.org_id,
    userId: session.user.id,
  });

  return NextResponse.json({
    token,
    deepLink,
    expiresAt: expiresAt.toISOString(),
  });
}
