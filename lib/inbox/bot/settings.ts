// Read-only bot settings resolver (used by the engine + cron).
// Mutations live in knowledge-actions.ts.

import { prisma } from "@/lib/prisma";

// Topics that may carry a CEO-uploaded image to send with the canned reply.
// Keep in sync with InboxTopic in classify.ts and the bot UI.
export type FlowImageTopic =
  | "money_lost"
  | "scan_fail"
  | "strong"
  | "buy"
  | "feedback"
  | "intro";

export const FLOW_IMAGE_TOPICS: FlowImageTopic[] = [
  "money_lost",
  "scan_fail",
  "strong",
  "buy",
  "feedback",
  "intro",
];

export type FlowImages = Partial<Record<FlowImageTopic, string>>;

export interface BotSettings {
  botEnabled: boolean;
  tone: string;
  botName: string | null;
  contactPhone: string | null;
  fallbackText: string;
  escalateText: string | null;
  dailySummary: boolean;
  flowImages: FlowImages;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  botEnabled: true,
  tone: "สุภาพ สั้น เป็นกันเอง",
  botName: null,
  contactPhone: null,
  fallbackText: "ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ",
  escalateText: null,
  dailySummary: true,
  flowImages: {},
};

// Normalize the JSONB column down to a typed record of topic → public URL.
// Hostile values (non-strings, non-http URLs) are silently dropped so we
// never push a bogus URL to LINE / FB.
export function pickFlowImages(raw: unknown): FlowImages {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: FlowImages = {};
  for (const t of FLOW_IMAGE_TOPICS) {
    const v = r[t];
    if (typeof v === "string" && /^https?:\/\//.test(v)) out[t] = v;
  }
  return out;
}

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
    flowImages: pickFlowImages(s.flowImages),
  };
}
