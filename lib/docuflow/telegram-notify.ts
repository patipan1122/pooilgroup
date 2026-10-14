// DocuFlow — notify a real signer via Telegram when a new signature
// placement is created for them (CEO #8, 2026-10-14).
// ────────────────────────────────────────────────────────────────────
// Called from app/api/docuflow/[id]/signatures/route.ts's POST handler,
// right after a placement with placementType="signature" and a concrete
// signerUserId is created (auto-fill date/name/text placements, and
// placements with no linked user yet, never reach this).
//
// Non-blocking by design: every failure path here resolves (never
// throws) so a Telegram outage can NEVER break placement creation — same
// try/catch-and-swallow discipline app/api/cashhub/reports/route.ts
// already uses around its own sendTelegramMessage call. Callers still
// `await` this (matching that same precedent) so the log order stays
// predictable; it just never surfaces an error upward.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { buildSignRequestMessage, signRequestKeyboard } from "@/lib/docuflow/telegram-alerts";

export async function notifySignerTelegram(params: {
  orgId: string;
  documentName: string;
  placementId: string;
  signerUserId: string;
  baseUrl: string;
}): Promise<void> {
  try {
    const signer = await prisma.user.findFirst({
      where: { id: params.signerUserId, orgId: params.orgId, isActive: true },
      select: { name: true, telegramChatId: true },
    });
    // Not connected (or not found) — silent no-op. The signer still sees
    // this in /docuflow/notifications' in-app feed; Telegram is a bonus
    // channel, never the only one.
    if (!signer?.telegramChatId) return;

    const signUrl = `${params.baseUrl}/sign/${params.placementId}`;
    const text = buildSignRequestMessage({
      documentName: params.documentName,
      signerName: signer.name,
    });

    await sendTelegramMessage({
      chatId: signer.telegramChatId,
      text,
      parseMode: "HTML",
      inlineKeyboard: signRequestKeyboard(signUrl),
    });
  } catch (err) {
    console.error("[docuflow] notifySignerTelegram failed", err);
  }
}
