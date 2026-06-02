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

// Editable per-flow reply text.  Each key is one situation the bot answers
// with a canned reply; the CEO can override any of them from /inbox/bot
// (used to be hardcoded in templates.ts — un-hardcoded so training actually
// changes what customers receive).  Use the literal "{phone}" as a placeholder
// for the contact phone; it's filled at render time.
export type ReplyTemplateKey =
  | "money_lost"
  | "scan_fail"
  | "strong"
  | "buy"
  | "feedback"
  | "feedback_complaint"
  | "non_text_ack";

export const REPLY_TEMPLATE_KEYS: ReplyTemplateKey[] = [
  "money_lost",
  "scan_fail",
  "strong",
  "buy",
  "feedback",
  "feedback_complaint",
  "non_text_ack",
];

// Human-readable Thai labels for the bot-training UI + Claude trainer prompt.
export const REPLY_TEMPLATE_LABELS: Record<ReplyTemplateKey, string> = {
  money_lost: "เครื่องกินเงิน / หยอดแล้วไม่ทำงาน",
  scan_fail: "สแกน / จ่าย QR ไม่ได้",
  strong: "นวดแรง / เจ็บ",
  buy: "สนใจซื้อ / ลงทุน",
  feedback: "ติชม (ทั่วไป)",
  feedback_complaint: "ติชม (ร้องเรียน / ไม่พอใจ)",
  non_text_ack: "ลูกค้าส่งรูป / สติกเกอร์ / เสียง",
};

export type ReplyTemplates = Partial<Record<ReplyTemplateKey, string>>;

export interface BotSettings {
  botEnabled: boolean;
  tone: string;
  botName: string | null;
  contactPhone: string | null;
  fallbackText: string;
  escalateText: string | null;
  dailySummary: boolean;
  flowImages: FlowImages;
  replyTemplates: ReplyTemplates;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  botEnabled: true,
  tone: "สุภาพ สั้น เป็นกันเอง",
  botName: null,
  contactPhone: null,
  fallbackText: "ขออภัยค่ะ เดี๋ยวทีมงานช่วยดูแลให้นะคะ สอบถามเพิ่มเติมโทรได้ที่ 084-198-1623 ค่ะ",
  escalateText: null,
  dailySummary: true,
  flowImages: {},
  replyTemplates: {},
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

// Normalize the reply_templates JSONB → typed record of editable replies.
// Drops unknown keys + non-string / blank values so the engine always falls
// back to the built-in default for anything not explicitly overridden.
export function pickReplyTemplates(raw: unknown): ReplyTemplates {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ReplyTemplates = {};
  for (const k of REPLY_TEMPLATE_KEYS) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
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
  // flowImages + replyTemplates live in JSONB columns fetched via resilient
  // raw SQL — each tolerates its column being absent (migration not yet run)
  // so the bot keeps replying with built-in defaults in the meantime.
  const [flowImages, replyTemplates] = await Promise.all([
    loadFlowImagesSafe(orgId, businessTag),
    loadReplyTemplatesSafe(orgId, businessTag),
  ]);
  return {
    botEnabled: s.botEnabled,
    tone: s.tone,
    botName: s.botName,
    contactPhone: s.contactPhone,
    fallbackText: s.fallbackText,
    escalateText: s.escalateText,
    dailySummary: s.dailySummary,
    flowImages,
    replyTemplates,
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

/**
 * Read reply_templates via raw SQL.  Returns {} when the column is missing
 * (pre-migration) so the bot keeps using built-in default replies until the
 * 20260602160000 DDL has been applied.
 */
export async function loadReplyTemplatesSafe(
  orgId: string,
  businessTag: string,
): Promise<ReplyTemplates> {
  try {
    const rows = await prisma.$queryRaw<{ reply_templates: unknown }[]>`
      SELECT reply_templates FROM public.inbox_bot_settings
      WHERE org_id = ${orgId}::uuid AND business_tag = ${businessTag}
      LIMIT 1
    `;
    return pickReplyTemplates(rows[0]?.reply_templates);
  } catch {
    return {};
  }
}
