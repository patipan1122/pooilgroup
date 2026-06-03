import { prisma } from "@/lib/prisma";

const DAY = 864e5;
export function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / DAY);
}

// เกินรอบซื้อ = ลูกค้าเก่า + ผ่านมานานกว่ารอบปกติ x1.5
export function isOverdue(c: { firstOrderAt: Date | null; lastOrderAt: Date | null; normalCadenceDays: number | null }): boolean {
  if (!c.firstOrderAt || !c.lastOrderAt || !c.normalCadenceDays) return false;
  const d = daysSince(c.lastOrderAt);
  return d != null && d > c.normalCadenceDays * 1.5;
}

export type CustomerFilter = "all" | "overdue" | "prospect" | "mine";

export async function listCustomers(
  orgId: string,
  opts: { filter: CustomerFilter; q?: string; userId: string },
) {
  const where: Record<string, unknown> = { orgId, isActive: true };
  if (opts.filter === "prospect") where.firstOrderAt = null;
  if (opts.filter === "mine") where.assignedSalesId = opts.userId;
  if (opts.q) where.name = { contains: opts.q, mode: "insensitive" };

  const rows = await prisma.customer.findMany({
    where,
    orderBy: { lastOrderAt: { sort: "desc", nulls: "last" } },
    take: 300,
    include: { assignedSales: { select: { name: true } } },
  });

  let mapped = rows.map((c) => ({
    id: c.id,
    name: c.name,
    zone: c.zone,
    owner: c.assignedSales?.name ?? null,
    creditLimit: c.creditLimit ? Number(c.creditLimit) : null,
    creditUsed: Number(c.creditUsed),
    lastOrderAt: c.lastOrderAt,
    cadence: c.normalCadenceDays,
    isProspect: !c.firstOrderAt,
    overdue: isOverdue(c),
    daysSinceOrder: daysSince(c.lastOrderAt),
  }));

  if (opts.filter === "overdue") mapped = mapped.filter((m) => m.overdue);
  return mapped;
}

export async function getCustomer(orgId: string, id: string) {
  const c = await prisma.customer.findFirst({
    where: { id, orgId },
    include: {
      assignedSales: { select: { id: true, name: true } },
      locations: true,
      conversations: { select: { id: true }, take: 1 },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { items: { select: { qtyLiters: true } } },
      },
      quotes: { orderBy: { quoteDate: "desc" }, take: 10 },
      payments: { orderBy: { paymentDate: "desc" }, take: 10 },
      cheques: { orderBy: { dueDate: "desc" }, take: 10 },
      followUps: { where: { status: "OPEN" }, orderBy: { dueDate: "asc" } },
    },
  });
  if (!c) return null;

  // timeline การซื้อ + ยอดเดือนนี้ vs เฉลี่ย
  const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0, 0, 0, 0);
  let monthLiters = 0;
  const timeline = c.orders.map((o) => {
    const liters = o.items.reduce((s, it) => s + Number(it.qtyLiters), 0);
    if (new Date(o.createdAt) >= startMonth) monthLiters += liters;
    return { date: o.createdAt, liters, orderNo: o.orderNo, profit: Number(o.totalProfit), status: o.status };
  });
  // เฉลี่ยต่อเดือน (จากออเดอร์ย้อนหลังทั้งหมดที่ดึงมา / ช่วงเดือน)
  const totalLiters = timeline.reduce((s, t) => s + t.liters, 0);
  const spanDays = timeline.length > 1 ? Math.max(1, (Number(timeline[0].date) - Number(timeline[timeline.length - 1].date)) / DAY) : 30;
  const avgMonthly = Math.round((totalLiters / spanDays) * 30);
  const avgMargin = timeline.length ? timeline.reduce((s, t) => s + t.profit, 0) / timeline.length : 0;

  return {
    customer: c,
    health: { overdue: isOverdue(c), daysSinceOrder: daysSince(c.lastOrderAt), monthLiters, avgMonthly, avgMargin },
    timeline,
  };
}
