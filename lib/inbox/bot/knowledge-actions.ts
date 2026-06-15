"use server";

// Bot training — no-code CRUD for FAQ pairs, business knowledge, settings, and
// the "questions the bot couldn't answer" queue. Admin-only, org-scoped.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import {
  FLOW_IMAGE_TOPICS,
  REPLY_TEMPLATE_KEYS,
  REPLY_TEMPLATE_LABELS,
  loadFlowImagesSafe,
  loadReplyTemplatesSafe,
  pickFlowImages,
  pickReplyTemplates,
  type FlowImageTopic,
  type FlowImages,
  type ReplyTemplateKey,
} from "./settings";
import { DEFAULT_REPLY_TEMPLATES } from "./templates";
import { uploadBotAssetImage, validateImageBuffer } from "../storage";
import { assertBotCapable } from "../business";

const DEFAULT_TAG = "chairops";

// Audit BOT-006: every server action that takes a businessTag from a client
// input must validate against the registered bot-capable list before
// writing.  Wrapping the trim+fallback dance keeps it one line at call sites.
function resolveBizTag(input: string | undefined): string {
  return assertBotCapable(input?.trim() || DEFAULT_TAG);
}

async function requireAdmin() {
  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, "inbox")))
    throw new Error("ไม่มีสิทธิ์");
  return session;
}

function revalidate() {
  revalidatePath("/inbox/bot");
}

// ---------- FAQ ----------
export async function listFaqs(businessTag = DEFAULT_TAG) {
  const session = await requireAdmin();
  const rows = await prisma.inboxBotFaq.findMany({
    where: { orgId: session.user.org_id, businessTag },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      keywords: true,
      answer: true,
      intent: true,
      enabled: true,
      priority: true,
      hits: true,
    },
  });
  return rows;
}

export async function createFaq(input: {
  businessTag?: string;
  keywords: string;
  answer: string;
  intent?: string;
  priority?: number;
}) {
  const session = await requireAdmin();
  if (!input.keywords.trim() || !input.answer.trim()) {
    throw new Error("กรอกคำค้นและคำตอบ");
  }
  await prisma.inboxBotFaq.create({
    data: {
      orgId: session.user.org_id,
      businessTag: resolveBizTag(input.businessTag),
      keywords: input.keywords.trim(),
      answer: input.answer.trim(),
      intent: input.intent?.trim() || null,
      priority: input.priority ?? 0,
      createdById: session.user.id,
    },
  });
  revalidate();
  return { ok: true };
}

export async function updateFaq(
  id: string,
  input: { keywords?: string; answer?: string; intent?: string; priority?: number; enabled?: boolean },
) {
  const session = await requireAdmin();
  const existing = await prisma.inboxBotFaq.findUnique({ where: { id }, select: { orgId: true } });
  if (!existing || existing.orgId !== session.user.org_id) throw new Error("ไม่พบรายการ");
  await prisma.inboxBotFaq.update({
    where: { id },
    data: {
      ...(input.keywords !== undefined ? { keywords: input.keywords.trim() } : {}),
      ...(input.answer !== undefined ? { answer: input.answer.trim() } : {}),
      ...(input.intent !== undefined ? { intent: input.intent.trim() || null } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  revalidate();
  return { ok: true };
}

export async function deleteFaq(id: string) {
  const session = await requireAdmin();
  const existing = await prisma.inboxBotFaq.findUnique({ where: { id }, select: { orgId: true } });
  if (!existing || existing.orgId !== session.user.org_id) throw new Error("ไม่พบรายการ");
  await prisma.inboxBotFaq.delete({ where: { id } });
  revalidate();
  return { ok: true };
}

// ---------- Knowledge ----------
export async function listKnowledge(businessTag = DEFAULT_TAG) {
  const session = await requireAdmin();
  return prisma.inboxBotKnowledge.findMany({
    where: { orgId: session.user.org_id, businessTag },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, content: true, enabled: true },
  });
}

export async function createKnowledge(input: { businessTag?: string; title: string; content: string }) {
  const session = await requireAdmin();
  if (!input.title.trim() || !input.content.trim()) throw new Error("กรอกหัวข้อและเนื้อหา");
  await prisma.inboxBotKnowledge.create({
    data: {
      orgId: session.user.org_id,
      businessTag: resolveBizTag(input.businessTag),
      title: input.title.trim(),
      content: input.content.trim(),
      createdById: session.user.id,
    },
  });
  revalidate();
  return { ok: true };
}

export async function updateKnowledge(
  id: string,
  input: { title?: string; content?: string; enabled?: boolean },
) {
  const session = await requireAdmin();
  const existing = await prisma.inboxBotKnowledge.findUnique({ where: { id }, select: { orgId: true } });
  if (!existing || existing.orgId !== session.user.org_id) throw new Error("ไม่พบรายการ");
  await prisma.inboxBotKnowledge.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  revalidate();
  return { ok: true };
}

export async function deleteKnowledge(id: string) {
  const session = await requireAdmin();
  const existing = await prisma.inboxBotKnowledge.findUnique({ where: { id }, select: { orgId: true } });
  if (!existing || existing.orgId !== session.user.org_id) throw new Error("ไม่พบรายการ");
  await prisma.inboxBotKnowledge.delete({ where: { id } });
  revalidate();
  return { ok: true };
}

// ---------- Settings ----------
export async function getBotSettingsForm(businessTag = DEFAULT_TAG) {
  const session = await requireAdmin();
  // Explicit select so this page renders even before the flow_images column
  // exists (CEO may visit /inbox/bot before running migration 20260530000000).
  const s = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
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
  const flowImages = await loadFlowImagesSafe(session.user.org_id, businessTag);
  return {
    botEnabled: s?.botEnabled ?? true,
    tone: s?.tone ?? "สุภาพ สั้น เป็นกันเอง",
    botName: s?.botName ?? "",
    contactPhone: s?.contactPhone ?? "",
    fallbackText:
      s?.fallbackText ??
      "ขออภัยค่ะ เดี๋ยวทีมงานช่วยดูแลให้นะคะ สอบถามเพิ่มเติมโทรได้ที่ 084-198-1623 ค่ะ",
    escalateText: s?.escalateText ?? "",
    dailySummary: s?.dailySummary ?? true,
    flowImages,
  };
}

// ---------- Reply templates (editable canned replies for main flows) ----------

export interface ReplyTemplateRow {
  key: ReplyTemplateKey;
  label: string;
  text: string; // effective: CEO override else built-in default
  isCustom: boolean; // true when CEO has overridden the default
  defaultText: string;
}

// Effective reply templates for the bot-training UI: the override if present,
// otherwise the built-in default — plus a flag so the UI can show "แก้แล้ว".
export async function listReplyTemplates(
  businessTag = DEFAULT_TAG,
): Promise<ReplyTemplateRow[]> {
  const session = await requireAdmin();
  const tag = resolveBizTag(businessTag);
  const stored = await loadReplyTemplatesSafe(session.user.org_id, tag);
  return REPLY_TEMPLATE_KEYS.map((key) => {
    const override = stored[key]?.trim();
    return {
      key,
      label: REPLY_TEMPLATE_LABELS[key],
      text: override || DEFAULT_REPLY_TEMPLATES[key],
      isCustom: !!override,
      defaultText: DEFAULT_REPLY_TEMPLATES[key],
    };
  });
}

// Save (or reset) one editable reply. Empty text reverts to the built-in
// default. Merges into the reply_templates JSONB column — same upsert pattern
// as flow images so a missing settings row is created with defaults.
export async function saveReplyTemplate(input: {
  businessTag?: string;
  key: string;
  text: string;
}) {
  const session = await requireAdmin();
  const businessTag = resolveBizTag(input.businessTag);
  if (!(REPLY_TEMPLATE_KEYS as readonly string[]).includes(input.key)) {
    throw new Error("คีย์คำตอบไม่ถูกต้อง");
  }
  const existing = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    select: { replyTemplates: true },
  });
  const merged = { ...pickReplyTemplates(existing?.replyTemplates) };
  const text = input.text.trim();
  if (text) merged[input.key as ReplyTemplateKey] = text;
  else delete merged[input.key as ReplyTemplateKey]; // empty → revert to default

  await prisma.inboxBotSettings.upsert({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    create: {
      orgId: session.user.org_id,
      businessTag,
      replyTemplates: merged as object,
    },
    update: { replyTemplates: merged as object },
  });
  revalidate();
  return { ok: true };
}

// ---------- Flow images (per-topic bot template images) ----------

function isFlowTopic(t: string): t is FlowImageTopic {
  return (FLOW_IMAGE_TOPICS as readonly string[]).includes(t);
}

// Decode a "data:image/...;base64,..." URL into a buffer + content-type.
// We use base64 over the server-action boundary because Next 15 server
// actions don't support File transparently and the images are small (≤5 MB).
function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็น base64 data URL)");
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  return { buffer, contentType };
}

export async function uploadBotFlowImage(input: {
  topic: string;
  dataUrl: string;
  businessTag?: string;
}) {
  const session = await requireAdmin();
  if (!isFlowTopic(input.topic)) throw new Error("หัวข้อไม่ถูกต้อง");
  const businessTag = resolveBizTag(input.businessTag);

  const { buffer, contentType } = decodeDataUrl(input.dataUrl);
  const valid = validateImageBuffer(buffer);
  if (!valid.ok) throw new Error(valid.reason);

  const up = await uploadBotAssetImage({
    orgId: session.user.org_id,
    businessTag,
    topic: input.topic,
    buffer,
    contentType,
  });

  // Merge into the existing flowImages JSON.  Upsert handles "settings row
  // doesn't exist yet" by writing one with defaults + this image.
  const existing = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    select: { flowImages: true },
  });
  const merged: FlowImages = {
    ...pickFlowImages(existing?.flowImages),
    [input.topic]: up.url,
  };
  await prisma.inboxBotSettings.upsert({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    create: {
      orgId: session.user.org_id,
      businessTag,
      flowImages: merged as object,
    },
    update: { flowImages: merged as object },
  });
  revalidate();
  return { ok: true, url: up.url };
}

export async function removeBotFlowImage(input: {
  topic: string;
  businessTag?: string;
}) {
  const session = await requireAdmin();
  if (!isFlowTopic(input.topic)) throw new Error("หัวข้อไม่ถูกต้อง");
  const businessTag = resolveBizTag(input.businessTag);

  const existing = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    select: { flowImages: true },
  });
  const cur = pickFlowImages(existing?.flowImages);
  const merged: FlowImages = { ...cur };
  delete merged[input.topic as FlowImageTopic];

  await prisma.inboxBotSettings.upsert({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    create: {
      orgId: session.user.org_id,
      businessTag,
      flowImages: merged as object,
    },
    update: { flowImages: merged as object },
  });
  revalidate();
  return { ok: true };
}

export async function saveBotSettings(input: {
  businessTag?: string;
  botEnabled: boolean;
  tone: string;
  botName?: string;
  contactPhone?: string;
  fallbackText: string;
  escalateText?: string;
  dailySummary: boolean;
}) {
  const session = await requireAdmin();
  const businessTag = resolveBizTag(input.businessTag);
  const data = {
    botEnabled: input.botEnabled,
    tone: input.tone.trim() || "สุภาพ สั้น เป็นกันเอง",
    botName: input.botName?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    fallbackText: input.fallbackText.trim() || "ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ",
    escalateText: input.escalateText?.trim() || null,
    dailySummary: input.dailySummary,
  };
  await prisma.inboxBotSettings.upsert({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
    create: { orgId: session.user.org_id, businessTag, ...data },
    update: data,
  });
  revalidate();
  return { ok: true };
}

// ---------- Unanswered (training queue) ----------
export async function listUnanswered(businessTag = DEFAULT_TAG) {
  const session = await requireAdmin();
  return prisma.inboxBotUnanswered.findMany({
    where: { orgId: session.user.org_id, businessTag, resolved: false },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, question: true, createdAt: true },
  });
}

/** Resolve a queued question, optionally turning it into a new FAQ in one step. */
export async function resolveUnanswered(
  id: string,
  opts?: { keywords?: string; answer?: string },
) {
  const session = await requireAdmin();
  const row = await prisma.inboxBotUnanswered.findUnique({
    where: { id },
    select: { orgId: true, businessTag: true, question: true },
  });
  if (!row || row.orgId !== session.user.org_id) throw new Error("ไม่พบรายการ");

  if (opts?.keywords?.trim() && opts?.answer?.trim()) {
    await prisma.inboxBotFaq.create({
      data: {
        orgId: session.user.org_id,
        businessTag: row.businessTag,
        keywords: opts.keywords.trim(),
        answer: opts.answer.trim(),
        createdById: session.user.id,
      },
    });
  }
  await prisma.inboxBotUnanswered.update({ where: { id }, data: { resolved: true } });
  revalidate();
  return { ok: true };
}
