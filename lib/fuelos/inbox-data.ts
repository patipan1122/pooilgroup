import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

export type ConvFilter = "all" | "unanswered" | "mine";
export type ConvLabel = { id: string; name: string; color: string };

export async function listConversations(
  orgId: string,
  opts: { filter: ConvFilter; userId: string; q?: string; labelId?: string | null },
) {
  const where: Prisma.ConversationWhereInput = { orgId };
  if (opts.filter === "unanswered") where.isUnanswered = true;
  if (opts.filter === "mine") where.assignedToId = opts.userId;
  // กรองตามป้าย/หมวดหมู่ที่เลือก
  if (opts.labelId) where.labels = { some: { labelId: opts.labelId } };
  // ค้นหา: ชื่อแชท · ชื่อกลุ่ม · ชื่อลูกค้าที่ผูก · เนื้อหาข้อความ
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { lineGroupName: { contains: q, mode: "insensitive" } },
      { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
      { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const rows = await prisma.conversation.findMany({
    where,
    orderBy: [{ isUnanswered: "desc" }, { lastMessageAt: "desc" }],
    take: 100,
    include: {
      customer: { select: { id: true, name: true, zone: true, lastOrderAt: true, normalCadenceDays: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, senderType: true } },
      labels: { select: { label: { select: { id: true, name: true, color: true } } } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.customer?.name ?? c.lineGroupName ?? c.displayName ?? "(ไม่ทราบชื่อ)",
    pictureUrl: c.pictureUrl,
    isGroup: !!c.lineGroupId,
    zone: c.customer?.zone ?? null,
    segment: c.segment,
    isUnanswered: c.isUnanswered,
    unreadCount: c.unreadCount,
    assignee: c.assignedTo?.name ?? null,
    lastMessageAt: c.lastMessageAt,
    preview: c.messages[0]?.body ?? "",
    labels: c.labels.map((l) => l.label) as ConvLabel[],
  }));
}

// ป้าย/หมวดหมู่ทั้งหมดขององค์กร + จำนวนแชทในแต่ละป้าย (สำหรับชิปกรอง + ตัวจัดการป้าย)
export async function listLabels(orgId: string) {
  const labels = await prisma.fuelConvLabel.findMany({
    where: { orgId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true, _count: { select: { links: true } } },
  });
  return labels.map((l) => ({ id: l.id, name: l.name, color: l.color, count: l._count.links }));
}

export async function conversationCounts(orgId: string, userId: string) {
  const [all, unanswered, mine] = await Promise.all([
    prisma.conversation.count({ where: { orgId } }),
    prisma.conversation.count({ where: { orgId, isUnanswered: true } }),
    prisma.conversation.count({ where: { orgId, assignedToId: userId } }),
  ]);
  return { all, unanswered, mine };
}

export type LineContactLite = {
  lineUserId: string;
  displayName: string | null;
  alias: string | null;
  pictureUrl: string | null;
  roleLabel: string | null;
};

export async function getConversation(orgId: string, convId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, orgId },
    include: {
      customer: {
        select: {
          id: true, name: true, nickname: true, legalName: true, zone: true, phone: true,
          creditLimit: true, creditUsed: true,
          lastOrderAt: true, lastQuoteAt: true, normalCadenceDays: true, firstOrderAt: true,
        },
      },
      assignedTo: { select: { id: true, name: true } },
      labels: { select: { label: { select: { id: true, name: true, color: true } } } },
      // ดึง 50 ข้อความล่าสุด (desc) แล้วกลับลำดับเป็นเก่า→ใหม่ตอนแสดง
      messages: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { senderUser: { select: { name: true } } },
      },
    },
  });
  if (!conv) return null;
  conv.messages.reverse();

  // ดึงตัวตนคนใน LINE (ชื่อจริง/alias/รูป) ของช่องนี้ → map ตาม lineUserId
  const contacts: LineContactLite[] = conv.channelId
    ? await prisma.fuelLineContact.findMany({
        where: { channelId: conv.channelId },
        select: { lineUserId: true, displayName: true, alias: true, pictureUrl: true, roleLabel: true },
      })
    : [];
  const contactMap = new Map(contacts.map((c) => [c.lineUserId, c]));

  // แนบ contact ต่อข้อความ
  const messages = conv.messages.map((m) => ({
    ...m,
    senderContact: m.senderLineUserId ? contactMap.get(m.senderLineUserId) ?? null : null,
  }));

  // รายชื่อ "คนในกลุ่มนี้" (ลูกค้าที่เคยส่งในห้องนี้)
  const senders = await prisma.message.groupBy({
    by: ["senderLineUserId"],
    where: { conversationId: convId, senderType: "CUSTOMER", senderLineUserId: { not: null } },
  });
  const people: LineContactLite[] = senders
    .map((s) => s.senderLineUserId!)
    .map((uid) => contactMap.get(uid) ?? { lineUserId: uid, displayName: null, alias: null, pictureUrl: null, roleLabel: null });

  return { ...conv, messages, people };
}

// สถิติโปรไฟล์ลูกค้า (ใช้ใน popup/panel ฝั่งแชท) — ประวัติซื้อขาย/ปริมาณเฉลี่ย/margin
export async function customerProfileStats(orgId: string, customerId: string) {
  const [cust, orderAgg, itemAgg, recentOrders] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, orgId },
      select: {
        id: true, name: true, nickname: true, legalName: true, phone: true, zone: true, province: true,
        creditLimit: true, creditUsed: true, paymentTerms: true,
        firstOrderAt: true, lastOrderAt: true, normalCadenceDays: true, notes: true,
      },
    }),
    prisma.order.aggregate({ where: { orgId, customerId, status: { not: "CANCELLED" } }, _count: { _all: true } }),
    prisma.orderItem.aggregate({
      where: { order: { orgId, customerId, status: { not: "CANCELLED" } } },
      _sum: { qtyLiters: true, lineProfit: true },
      _avg: { marginPerLiter: true },
    }),
    prisma.order.findMany({
      where: { orgId, customerId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, orderNo: true, status: true, subtotal: true, createdAt: true },
    }),
  ]);
  if (!cust) return null;
  const orderCount = orderAgg._count._all;
  const totalLiters = Number(itemAgg._sum.qtyLiters ?? 0);
  return {
    ...cust,
    orderCount,
    totalLiters,
    avgLitersPerOrder: orderCount ? Math.round(totalLiters / orderCount) : 0,
    avgMarginPerL: Number(itemAgg._avg.marginPerLiter ?? 0),
    totalProfit: Number(itemAgg._sum.lineProfit ?? 0),
    recentOrders,
  };
}
