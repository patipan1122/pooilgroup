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

// ข้อความที่ serialize แล้ว (Date → ISO string) พร้อมส่งเข้า client component
export type ChatMessage = {
  id: string;
  direction: "IN" | "OUT";
  body: string;
  attachments: unknown;
  externalId: string | null;
  senderType: "CUSTOMER" | "STAFF";
  senderUserName: string | null;
  sentByBot: boolean;
  createdAt: string;
  senderContact: LineContactLite | null;
};

type RawMessage = {
  id: string;
  direction: string;
  body: string;
  attachments: unknown;
  externalId: string | null;
  senderType: string;
  senderLineUserId: string | null;
  sentByBot: boolean;
  createdAt: Date;
  senderUser: { name: string } | null;
};

function toChatMessage(m: RawMessage, contactMap: Map<string, LineContactLite>): ChatMessage {
  return {
    id: m.id,
    direction: m.direction as "IN" | "OUT",
    body: m.body,
    attachments: m.attachments ?? null,
    externalId: m.externalId,
    senderType: m.senderType as "CUSTOMER" | "STAFF",
    senderUserName: m.senderUser?.name ?? null,
    sentByBot: m.sentByBot,
    createdAt: m.createdAt.toISOString(),
    senderContact: m.senderLineUserId ? contactMap.get(m.senderLineUserId) ?? null : null,
  };
}

async function loadContactMap(channelId: string | null): Promise<Map<string, LineContactLite>> {
  const contacts: LineContactLite[] = channelId
    ? await prisma.fuelLineContact.findMany({
        where: { channelId },
        select: { lineUserId: true, displayName: true, alias: true, pictureUrl: true, roleLabel: true },
      })
    : [];
  return new Map(contacts.map((c) => [c.lineUserId, c]));
}

// ขนาดหน้าละ — เปิดแชทโชว์ 50 ล่าสุด แล้วกด "ดูข้อความเก่ากว่านี้" โหลดเพิ่มทีละ 50 ได้ลึกไม่จำกัด
const PAGE_SIZE = 50;

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
      // ดึง 50 ข้อความล่าสุด (+1 เพื่อเช็คว่ายังมีเก่ากว่านี้ไหม) แล้วกลับลำดับเป็นเก่า→ใหม่ตอนแสดง
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        include: { senderUser: { select: { name: true } } },
      },
    },
  });
  if (!conv) return null;

  const hasMoreMessages = conv.messages.length > PAGE_SIZE;
  const recent = hasMoreMessages ? conv.messages.slice(0, PAGE_SIZE) : conv.messages;

  // ดึงตัวตนคนใน LINE (ชื่อจริง/alias/รูป) ของช่องนี้ → map ตาม lineUserId
  const contactMap = await loadContactMap(conv.channelId);

  // serialize + กลับลำดับเป็น เก่า→ใหม่
  const messages = recent.map((m) => toChatMessage(m, contactMap)).reverse();

  // รายชื่อ "คนในกลุ่มนี้" (ลูกค้าที่เคยส่งในห้องนี้)
  const senders = await prisma.message.groupBy({
    by: ["senderLineUserId"],
    where: { conversationId: convId, senderType: "CUSTOMER", senderLineUserId: { not: null } },
  });
  const people: LineContactLite[] = senders
    .map((s) => s.senderLineUserId!)
    .map((uid) => contactMap.get(uid) ?? { lineUserId: uid, displayName: null, alias: null, pictureUrl: null, roleLabel: null });

  return { ...conv, messages, people, hasMoreMessages };
}

// โหลดข้อความที่ "เก่ากว่า" beforeMessageId อีกหนึ่งหน้า (กดดูย้อนหลังลึกได้เรื่อย ๆ)
export async function getOlderMessages(
  orgId: string,
  convId: string,
  beforeMessageId: string,
  take = PAGE_SIZE,
): Promise<{ messages: ChatMessage[]; hasMore: boolean } | null> {
  // กันข้ามองค์กร (IDOR) — แชทต้องเป็นของ org นี้
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, orgId },
    select: { id: true, channelId: true },
  });
  if (!conv) return null;

  // keyset pagination: ดึงรายการที่อยู่ "หลัง" cursor ในลำดับ createdAt desc (= เก่ากว่า) +1 เพื่อเช็คว่ายังมีต่อ
  const rows = await prisma.message.findMany({
    where: { conversationId: convId, orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: { id: beforeMessageId },
    skip: 1,
    take: take + 1,
    include: { senderUser: { select: { name: true } } },
  });
  const hasMore = rows.length > take;
  const slice = hasMore ? rows.slice(0, take) : rows;

  const contactMap = await loadContactMap(conv.channelId);
  const messages = slice.map((m) => toChatMessage(m, contactMap)).reverse();
  return { messages, hasMore };
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
