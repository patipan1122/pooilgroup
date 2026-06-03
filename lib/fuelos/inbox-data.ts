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

export async function getConversation(orgId: string, convId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, orgId },
    include: {
      customer: {
        select: {
          id: true, name: true, zone: true, phone: true, creditLimit: true, creditUsed: true,
          lastOrderAt: true, lastQuoteAt: true, normalCadenceDays: true, firstOrderAt: true,
        },
      },
      assignedTo: { select: { id: true, name: true } },
      // ดึง 50 ข้อความล่าสุด (desc) แล้วกลับลำดับเป็นเก่า→ใหม่ตอนแสดง
      // (ของเดิม asc take 200 = ได้ 200 ข้อความ "เก่าสุด" ผิด + payload ใหญ่)
      messages: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { senderUser: { select: { name: true } } },
      },
    },
  });
  if (conv) conv.messages.reverse();
  return conv;
}
