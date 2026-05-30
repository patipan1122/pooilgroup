"use server";

// Bot training — no-code CRUD for FAQ pairs, business knowledge, settings, and
// the "questions the bot couldn't answer" queue. Admin-only, org-scoped.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import {
  FLOW_IMAGE_TOPICS,
  pickFlowImages,
  type FlowImageTopic,
  type FlowImages,
} from "./settings";
import { uploadBotAssetImage, validateImageBuffer } from "../storage";

const DEFAULT_TAG = "chairops";

async function requireAdmin() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) throw new Error("ไม่มีสิทธิ์");
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
      businessTag: input.businessTag?.trim() || DEFAULT_TAG,
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
      businessTag: input.businessTag?.trim() || DEFAULT_TAG,
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
  const s = await prisma.inboxBotSettings.findUnique({
    where: { orgId_businessTag: { orgId: session.user.org_id, businessTag } },
  });
  return {
    botEnabled: s?.botEnabled ?? true,
    tone: s?.tone ?? "สุภาพ สั้น เป็นกันเอง",
    botName: s?.botName ?? "",
    contactPhone: s?.contactPhone ?? "",
    fallbackText: s?.fallbackText ?? "ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ",
    escalateText: s?.escalateText ?? "",
    dailySummary: s?.dailySummary ?? true,
    flowImages: s ? pickFlowImages(s.flowImages) : ({} as FlowImages),
  };
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
  const businessTag = input.businessTag?.trim() || DEFAULT_TAG;

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
  const businessTag = input.businessTag?.trim() || DEFAULT_TAG;

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
  const businessTag = input.businessTag?.trim() || DEFAULT_TAG;
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
