// Read-only bot settings resolver (used by the engine + cron).
// Mutations live in knowledge-actions.ts.

import { prisma } from "@/lib/prisma";

export interface BotSettings {
  botEnabled: boolean;
  tone: string;
  botName: string | null;
  contactPhone: string | null;
  fallbackText: string;
  escalateText: string | null;
  dailySummary: boolean;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  botEnabled: true,
  tone: "สุภาพ สั้น เป็นกันเอง",
  botName: null,
  contactPhone: null,
  fallbackText: "ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ",
  escalateText: null,
  dailySummary: true,
};

export async function getBotSettings(
  orgId: string,
  businessTag: string,
): Promise<BotSettings> {
  const s = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId, businessTag } },
  });
  if (!s) return { ...DEFAULT_BOT_SETTINGS };
  return {
    botEnabled: s.botEnabled,
    tone: s.tone,
    botName: s.botName,
    contactPhone: s.contactPhone,
    fallbackText: s.fallbackText,
    escalateText: s.escalateText,
    dailySummary: s.dailySummary,
  };
}
