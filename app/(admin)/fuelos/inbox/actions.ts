"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import { getPricingContext } from "@/lib/fuelos/pricing-data";
import { PRODUCT_LABELS, PRODUCT_ORDER, computeSellPrice } from "@/lib/fuelos/pricing";
import { formatNumber } from "@/lib/fuelos/utils/format";
import { pushLineMessage, pushLineSticker } from "@/lib/fuelos/line";
import type { ConvSegment } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";

async function ownConv(orgId: string, convId: string) {
  const c = await prisma.conversation.findFirst({ where: { id: convId, orgId }, select: { id: true } });
  if (!c) throw new Error("ไม่พบแชท");
}

export async function sendReply(convId: string, body: string) {
  const user = await requireUser();
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, orgId: user.orgId },
    select: {
      id: true, lineGroupId: true, externalUserId: true,
      channel: { select: { accessTokenEnc: true } },
    },
  });
  if (!conv) throw new Error("ไม่พบแชท");
  const text = body.trim();
  if (!text) return { ok: false };
  const now = new Date();

  // ส่งเข้า LINE จริง (ถ้าช่องทางมี token + รู้ปลายทาง) — best-effort
  let errorMessage: string | null = null;
  const token = conv.channel?.accessTokenEnc;
  const to = conv.lineGroupId ?? conv.externalUserId;
  if (token && to) {
    try {
      const r = await pushLineMessage(token, to, text);
      if (!r.ok) errorMessage = `ส่ง LINE ไม่สำเร็จ (HTTP ${r.status})`;
    } catch {
      errorMessage = "ส่ง LINE ไม่สำเร็จ (เครือข่าย)";
    }
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        orgId: user.orgId, conversationId: convId, direction: "OUT",
        senderType: "STAFF", senderUserId: user.id, body: text,
      },
    }),
    prisma.conversation.update({
      where: { id: convId },
      data: { isUnanswered: false, unreadCount: 0, lastStaffReplyAt: now, lastMessageAt: now },
    }),
  ]);
  revalidatePath("/inbox");
  return { ok: true, warning: errorMessage };
}

// ส่งสติกเกอร์เข้า LINE (เซลล์กดส่งสติกเกอร์ตอบลูกค้าได้)
export async function sendSticker(convId: string, packageId: string, stickerId: string) {
  const user = await requireUser();
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, orgId: user.orgId },
    select: {
      id: true, lineGroupId: true, externalUserId: true,
      channel: { select: { accessTokenEnc: true } },
    },
  });
  if (!conv) throw new Error("ไม่พบแชท");
  if (!packageId || !stickerId) return { ok: false };
  const now = new Date();

  let warning: string | null = null;
  const token = conv.channel?.accessTokenEnc;
  const to = conv.lineGroupId ?? conv.externalUserId;
  if (token && to) {
    try {
      const r = await pushLineSticker(token, to, packageId, stickerId);
      if (!r.ok) warning = `ส่งสติกเกอร์ไม่สำเร็จ (HTTP ${r.status})`;
    } catch {
      warning = "ส่งสติกเกอร์ไม่สำเร็จ (เครือข่าย)";
    }
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        orgId: user.orgId, conversationId: convId, direction: "OUT",
        senderType: "STAFF", senderUserId: user.id, body: "[สติกเกอร์]",
        attachments: { type: "sticker", stickerId } as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.conversation.update({
      where: { id: convId },
      data: { isUnanswered: false, unreadCount: 0, lastStaffReplyAt: now, lastMessageAt: now },
    }),
  ]);
  revalidatePath("/inbox");
  return { ok: true, warning };
}

export async function quickStatus(convId: string, label: string) {
  const user = await requireUser();
  await ownConv(user.orgId, convId);
  const now = new Date();
  await prisma.$transaction([
    prisma.message.create({
      data: {
        orgId: user.orgId, conversationId: convId, direction: "OUT",
        senderType: "STAFF", senderUserId: user.id, body: `📌 สถานะ: ${label}`,
      },
    }),
    prisma.conversation.update({
      where: { id: convId },
      data: { isUnanswered: false, lastStaffReplyAt: now, lastMessageAt: now },
    }),
  ]);
  await audit({ orgId: user.orgId, userId: user.id, action: "CONV_STATUS", entity: "Conversation", entityId: convId, meta: { label } });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function assignConv(convId: string, userId: string) {
  const user = await requireUser();
  await ownConv(user.orgId, convId);
  await prisma.conversation.update({ where: { id: convId }, data: { assignedToId: userId || null } });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function setSegment(convId: string, segment: ConvSegment) {
  const user = await requireUser();
  await ownConv(user.orgId, convId);
  await prisma.conversation.update({ where: { id: convId }, data: { segment } });
  revalidatePath("/inbox");
  return { ok: true };
}

// F4 — เครื่องมือช่วยเซลล์: แปะราคาวันนี้
export async function todayPriceText(zone: string | null): Promise<string> {
  const user = await requireUser();
  const ctx = await getPricingContext(user.orgId);
  const lines: string[] = [`💧 ราคาน้ำมันวันนี้${zone ? ` (โซน ${zone})` : ""}`];
  for (const p of PRODUCT_ORDER) {
    const cost = ctx.costs[p];
    if (cost == null) continue;
    const zm = zone ? ctx.margins[zone]?.[p]?.base ?? 0.45 : 0.45;
    lines.push(`${PRODUCT_LABELS[p]} = ${formatNumber(computeSellPrice({ costPerL: cost, zoneMargin: zm, salesMargin: 0 }))} บาท/ลิตร`);
  }
  lines.push("(ราคาส่งถึงหน้าโรง · สอบถามเพิ่มเติมได้เลยครับ)");
  return lines.join("\n");
}

// F4 — ดึงเลขบัญชีโอน
export async function bankText(): Promise<string> {
  const user = await requireUser();
  const acc = await prisma.bankAccount.findFirst({ where: { orgId: user.orgId }, orderBy: { isDefault: "desc" } });
  if (!acc) return "ยังไม่ได้ตั้งค่าบัญชีธนาคาร";
  return `🏦 โอนเข้า\n${acc.bankName} ${acc.accountNo}\nชื่อบัญชี: ${acc.accountName}`;
}
