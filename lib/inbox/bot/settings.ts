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
  // Explicit select omits `flowImages` so this runs even when the column
  // hasn't been added to prod yet (migration 20260530000000 might not be
  // applied at deploy time — see audit-log lessons).  flowImages is then
  // fetched via raw SQL with a try/catch so missing column is a no-op.
  const s = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId, businessTag } },
    select: {
      botEnabled: true,
      tone: true,
      botName: true,
      contactPhone: true,
      fallbackText: true,
      escalateText: true,
      dailySummary: true,
    },
  });
  if (!s) return { ...DEFAULT_BOT_SETTINGS };
  const flowImages = await loadFlowImagesSafe(orgId, businessTag);
  return {
    botEnabled: s.botEnabled,
    tone: s.tone,
    botName: s.botName,
    contactPhone: s.contactPhone,
    fallbackText: s.fallbackText,
    escalateText: s.escalateText,
    dailySummary: s.dailySummary,
    flowImages,
  };
}

/**
 * Read flow_images via raw SQL.  Returns {} when the column is missing
 * (pre-migration) — letting the bot keep replying text even before the
 * image feature's DDL has been applied.
 */
export async function loadFlowImagesSafe(
  orgId: string,
  businessTag: string,
): Promise<FlowImages> {
  try {
    const rows = await prisma.$queryRaw<{ flow_images: unknown }[]>`
      SELECT flow_images FROM public.inbox_bot_settings
      WHERE org_id = ${orgId}::uuid AND business_tag = ${businessTag}
      LIMIT 1
    `;
    return pickFlowImages(rows[0]?.flow_images);
  } catch {
    return {};
  }
}
