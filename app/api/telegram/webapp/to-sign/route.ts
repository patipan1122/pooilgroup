// GET /api/telegram/webapp/to-sign — Telegram Mini App's "what's pending"
// ────────────────────────────────────────────────────────────────────
// Mini-App-facing read endpoint. Validates the caller via
// `resolveTelegramWebAppUser()` (lib/telegram/webapp-auth.ts — the ONLY
// auth boundary for this route, no cookie session exists here), then
// returns the SAME document shape app/sign/to-sign/page.tsx already
// renders, via the shared `getToSignDocuments()` query
// (lib/docuflow/to-sign.ts) — not a divergent re-implementation.
//
// Three distinct response shapes the client UI must branch on:
//   - `connected: false, reason: "not_connected"` — this Telegram account
//     isn't paired to a Pooilgroup user yet → show "เชื่อมบัญชีก่อนใช้งาน".
//   - `connected: false, reason: "invalid"` — missing/bad/expired
//     initData → treat as a hard auth failure (shouldn't happen for a
//     real Telegram client; most likely means the page was opened
//     outside Telegram or initData aged out).
//   - `connected: true, ...` — normal data payload.
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { resolveTelegramWebAppUser } from "@/lib/telegram/webapp-auth";
import { getToSignDocuments } from "@/lib/docuflow/to-sign";
import { getMySignatureUrl } from "@/lib/docuflow/my-signature";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const resolved = await resolveTelegramWebAppUser(req);

  if (!resolved.ok) {
    // "not_connected" is an expected, user-facing state (not an error) —
    // 200 so the client doesn't treat it as a network/server failure.
    // "invalid" (bad/missing/expired signature) is a real auth failure.
    return NextResponse.json(
      { connected: false, reason: resolved.reason },
      { status: resolved.reason === "not_connected" ? 200 : 401 },
    );
  }

  const { user } = resolved;

  const [documents, savedSignatureUrl] = await Promise.all([
    getToSignDocuments(user.orgId, user.id),
    getMySignatureUrl(user.id).catch(() => null),
  ]);

  return NextResponse.json({
    connected: true,
    userName: user.name,
    hasSavedSignature: !!savedSignatureUrl,
    savedSignatureUrl,
    documents,
  });
}
