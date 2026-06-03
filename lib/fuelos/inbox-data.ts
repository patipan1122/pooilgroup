import { prisma } from "@/lib/prisma";

export type ConvFilter = "all" | "unanswered" | "mine";

export async function listConversations(
  orgId: string,
  opts: { filter: ConvFilter; userId: string },
) {
  const where: Record<string, unknown> = { orgId };
  if (opts.filter === "unanswered") where.isUnanswered = true;
  if (opts.filter === "mine") where.assignedToId = opts.userId;

  const rows = await prisma.conversation.findMany({
    where,
    orderBy: [{ isUnanswered: "desc" }, { lastMessageAt: "desc" }],
    take: 100,
    include: {
      customer: { select: { id: true, name: true, zone: true, lastOrderAt: true, normalCadenceDays: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, senderType: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.customer?.name ?? c.displayName ?? "(ไม่ทราบชื่อ)",
    zone: c.customer?.zone ?? null,
    segment: c.segment,
    isUnanswered: c.isUnanswered,
    unreadCount: c.unreadCount,
    assignee: c.assignedTo?.name ?? null,
    lastMessageAt: c.lastMessageAt,
    preview: c.messages[0]?.body ?? "",
  }));
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
