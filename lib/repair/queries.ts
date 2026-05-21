// Repair — read-only data queries (Server Components / actions).
import { prisma } from "@/lib/prisma";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";

export interface TicketListFilters {
  orgId: string;
  status?: RepairTicketStatus | null;
  urgency?: RepairUrgency | null;
  branchId?: string | null;
  companyId?: string | null;
  categoryId?: string | null;
  assignedTechId?: string | null;
  query?: string | null;
}

export async function countTicketsByStatus(orgId: string, companyId?: string | null) {
  const counts = await prisma.repairTicket.groupBy({
    by: ["status"],
    where: companyId ? { orgId, companyId } : { orgId },
    _count: { _all: true },
  });
  const map: Record<RepairTicketStatus, number> = {
    NEW: 0,
    ACK: 0,
    IN_PROGRESS: 0,
    WAITING_PARTS: 0,
    RESOLVED: 0,
    CLOSED: 0,
    CANCELLED: 0,
  };
  for (const c of counts) map[c.status] = c._count._all;
  return map;
}

export async function countTicketsByUrgency(orgId: string, openOnly = true, companyId?: string | null) {
  const where: Record<string, unknown> = { orgId };
  if (companyId) where.companyId = companyId;
  if (openOnly) where.status = { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] };
  const counts = await prisma.repairTicket.groupBy({
    by: ["urgency"],
    where,
    _count: { _all: true },
  });
  const map: Record<RepairUrgency, number> = { URGENT: 0, NORMAL: 0, LOW: 0 };
  for (const c of counts) map[c.urgency] = c._count._all;
  return map;
}

export async function sumOpenCost(orgId: string, companyId?: string | null) {
  const where: Record<string, unknown> = {
    orgId,
    status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED"] },
    createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
  };
  if (companyId) where.companyId = companyId;
  const r = await prisma.repairTicket.aggregate({
    where,
    _sum: { partsCostCents: true, laborCostCents: true },
  });
  return (r._sum.partsCostCents ?? 0) + (r._sum.laborCostCents ?? 0);
}

/** Count of tickets created in the last N hours. */
export async function countNewSince(orgId: string, hoursAgo: number, companyId?: string | null) {
  const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const where: Record<string, unknown> = { orgId, createdAt: { gte: since } };
  if (companyId) where.companyId = companyId;
  return prisma.repairTicket.count({ where });
}

/** Top branches by open ticket count. */
export async function hotspotBranches(orgId: string, limit = 6, companyId?: string | null) {
  const where: Record<string, unknown> = {
    orgId,
    status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
  };
  if (companyId) where.companyId = companyId;
  const groups = await prisma.repairTicket.groupBy({
    by: ["branchId"],
    where,
    _count: { _all: true },
    _sum: { partsCostCents: true, laborCostCents: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });
  const branchIds = groups.map((g) => g.branchId).filter((x): x is string => !!x);
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true, code: true, province: true, businessType: true },
  });
  const map = new Map(branches.map((b) => [b.id, b]));
  return groups
    .filter((g) => g.branchId && map.has(g.branchId))
    .map((g) => ({
      branch: map.get(g.branchId!)!,
      openCount: g._count._all,
      costCents: (g._sum.partsCostCents ?? 0) + (g._sum.laborCostCents ?? 0),
    }));
}

/** Category breakdown for open tickets. */
export async function categoryBreakdown(orgId: string, companyId?: string | null) {
  const where: Record<string, unknown> = {
    orgId,
    status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
  };
  if (companyId) where.companyId = companyId;
  const groups = await prisma.repairTicket.groupBy({
    by: ["categoryId"],
    where,
    _count: { _all: true },
  });
  const cats = await prisma.repairCategory.findMany({
    where: { orgId, isActive: true },
    select: { id: true, label: true, emoji: true, slug: true },
    orderBy: { sortOrder: "asc" },
  });
  return cats
    .map((c) => ({
      category: c,
      count: groups.find((g) => g.categoryId === c.id)?._count._all ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Workload per technician (open + urgent counts). */
export async function technicianWorkload(orgId: string, companyId?: string | null) {
  const techs = await prisma.repairTechnician.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  const where: Record<string, unknown> = {
    orgId,
    assignedTechId: { not: null },
    status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
  };
  if (companyId) where.companyId = companyId;
  const groups = await prisma.repairTicket.groupBy({
    by: ["assignedTechId", "urgency"],
    where,
    _count: { _all: true },
  });
  return techs
    .map((t) => {
      const all = groups.filter((g) => g.assignedTechId === t.id);
      const active = all.reduce((s, g) => s + g._count._all, 0);
      const urgent = all
        .filter((g) => g.urgency === "URGENT")
        .reduce((s, g) => s + g._count._all, 0);
      return { tech: t, active, urgent };
    })
    .filter((w) => w.active > 0)
    .sort((a, b) => b.active - a.active);
}

/** Recent events for an activity feed. */
export async function recentActivity(orgId: string, limit = 12, companyId?: string | null) {
  const where: Record<string, unknown> = { orgId };
  if (companyId) where.ticket = { companyId };
  return prisma.repairTimelineEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, name: true } },
      ticket: {
        select: {
          id: true,
          ticketCode: true,
          title: true,
          urgency: true,
          status: true,
          branch: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });
}

/** Buckets needed for the action queue (assign / approve / parts / sla). */
export async function actionQueueBuckets(orgId: string, limit = 6, companyId?: string | null) {
  const base: Record<string, unknown> = { orgId };
  if (companyId) base.companyId = companyId;
  const include = {
    branch: { select: { id: true, name: true, code: true } },
    category: { select: { id: true, label: true, emoji: true } },
    assignedTech: { select: { id: true, name: true } },
  };
  const orderBy = [
    { urgency: "asc" as const },
    { createdAt: "asc" as const },
  ];
  const [needAssign, needAck, partsWait, slaRisk] = await Promise.all([
    prisma.repairTicket.findMany({
      where: { ...base, status: "NEW", assignedTechId: null },
      take: limit,
      orderBy,
      include,
    }),
    prisma.repairTicket.findMany({
      where: { ...base, status: "ACK" },
      take: limit,
      orderBy,
      include,
    }),
    prisma.repairTicket.findMany({
      where: { ...base, status: "WAITING_PARTS" },
      take: limit,
      orderBy,
      include,
    }),
    prisma.repairTicket.findMany({
      where: {
        ...base,
        status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
        resolveDueAt: { lte: new Date(Date.now() + 60 * 60 * 1000) },
      },
      take: limit,
      orderBy: [{ resolveDueAt: "asc" }],
      include,
    }),
  ]);
  return { needAssign, needAck, partsWait, slaRisk };
}

/** 8-week cost trend (rolling weeks, oldest first). */
export async function costTrend8w(orgId: string, companyId?: string | null) {
  const now = new Date();
  const weeks: { weekStart: Date; weekEnd: Date }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    weeks.push({ weekStart: start, weekEnd: end });
  }
  const baseWhere: Record<string, unknown> = { orgId };
  if (companyId) baseWhere.companyId = companyId;
  const results = await Promise.all(
    weeks.map((w) =>
      prisma.repairTicket.aggregate({
        where: {
          ...baseWhere,
          OR: [
            { resolvedAt: { gte: w.weekStart, lt: w.weekEnd } },
            { closedAt: { gte: w.weekStart, lt: w.weekEnd } },
          ],
        },
        _sum: { partsCostCents: true, laborCostCents: true },
      }),
    ),
  );
  return results.map((r, i) => ({
    weekIndex: i,
    weekStart: weeks[i].weekStart,
    cents: (r._sum.partsCostCents ?? 0) + (r._sum.laborCostCents ?? 0),
  }));
}

/** Created vs resolved counts per day for the last 7 days. */
export async function volumeByDay(orgId: string, companyId?: string | null) {
  const days: { label: string; start: Date; end: Date }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    days.push({ label: labels[(start.getDay() + 6) % 7], start, end });
  }
  const baseWhere: Record<string, unknown> = { orgId };
  if (companyId) baseWhere.companyId = companyId;
  const data = await Promise.all(
    days.map(async (d) => {
      const [created, resolved] = await Promise.all([
        prisma.repairTicket.count({
          where: { ...baseWhere, createdAt: { gte: d.start, lt: d.end } },
        }),
        prisma.repairTicket.count({
          where: { ...baseWhere, resolvedAt: { gte: d.start, lt: d.end } },
        }),
      ]);
      return { label: d.label, created, resolved };
    }),
  );
  return data;
}

export async function listTickets(filters: TicketListFilters, limit = 50) {
  const where: Record<string, unknown> = { orgId: filters.orgId };
  if (filters.status) where.status = filters.status;
  if (filters.urgency) where.urgency = filters.urgency;
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.assignedTechId) where.assignedTechId = filters.assignedTechId;
  if (filters.query) {
    const q = filters.query.trim();
    if (q.length > 0) {
      where.OR = [
        { ticketCode: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { reporterName: { contains: q, mode: "insensitive" } },
        { reporterPhone: { contains: q } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  return prisma.repairTicket.findMany({
    where,
    orderBy: [
      { status: "asc" },
      { urgency: "asc" },
      { createdAt: "desc" },
    ],
    take: limit,
    include: {
      branch: { select: { id: true, name: true, code: true, businessType: true } },
      category: { select: { id: true, slug: true, label: true, emoji: true } },
      assignedTech: { select: { id: true, name: true, kind: true } },
      _count: { select: { photos: true, parts: true, events: true } },
    },
  });
}

export async function getTicketDetail(orgId: string, idOrCode: string) {
  const isCode = idOrCode.startsWith("RP-");
  const ticket = await prisma.repairTicket.findFirst({
    where: isCode
      ? { orgId, ticketCode: idOrCode }
      : { orgId, id: idOrCode },
    include: {
      branch: { select: { id: true, name: true, code: true, businessType: true, province: true } },
      company: { select: { id: true, name: true, code: true } },
      category: { select: { id: true, slug: true, label: true, emoji: true } },
      assignedTech: {
        select: { id: true, name: true, kind: true, phone: true, lineId: true },
      },
      reporterUser: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      photos: { orderBy: { createdAt: "desc" } },
      parts: { orderBy: { createdAt: "asc" } },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  return ticket;
}

export async function listCategories(orgId: string) {
  return prisma.repairCategory.findMany({
    where: { orgId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function listTechnicians(orgId: string, activeOnly = true) {
  return prisma.repairTechnician.findMany({
    where: activeOnly ? { orgId, isActive: true } : { orgId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
}

export async function listBranches(orgId: string) {
  return prisma.branch.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, code: true, businessType: true, province: true, companyId: true },
    orderBy: { name: "asc" },
  });
}

export async function listCompanies(orgId: string) {
  return prisma.company.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });
}

/** Parts queue aggregated by name+spec for purchasing */
export async function partsQueue(orgId: string) {
  const parts = await prisma.repairPart.findMany({
    where: { orgId, status: { in: ["NEEDED", "ORDERED", "DELIVERED"] } },
    include: {
      ticket: {
        select: {
          id: true,
          ticketCode: true,
          title: true,
          urgency: true,
          status: true,
          branch: { select: { name: true, code: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  // Group by name+spec for buy-list view
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      spec: string | null;
      totalQty: number;
      statusBreakdown: Record<string, number>;
      items: typeof parts;
    }
  >();

  for (const p of parts) {
    const key = `${p.name.toLowerCase().trim()}|${(p.spec ?? "").toLowerCase().trim()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: p.name,
        spec: p.spec,
        totalQty: 0,
        statusBreakdown: { NEEDED: 0, ORDERED: 0, DELIVERED: 0, INSTALLED: 0, CANCELLED: 0 },
        items: [],
      });
    }
    const g = groups.get(key)!;
    g.totalQty += p.quantity;
    g.statusBreakdown[p.status] = (g.statusBreakdown[p.status] ?? 0) + p.quantity;
    g.items.push(p);
  }

  return { rawParts: parts, groups: Array.from(groups.values()) };
}

/** Tech's own queue */
export async function listTechnicianJobs(orgId: string, technicianId: string) {
  return prisma.repairTicket.findMany({
    where: {
      orgId,
      assignedTechId: technicianId,
      status: { notIn: ["CLOSED", "CANCELLED"] },
    },
    orderBy: [{ urgency: "asc" }, { resolveDueAt: "asc" }],
    include: {
      branch: { select: { id: true, name: true, code: true, businessType: true } },
      category: { select: { id: true, slug: true, label: true, emoji: true } },
      _count: { select: { photos: true, parts: true } },
    },
  });
}

/** Find tech profile for a logged-in user (INTERNAL tech) */
export async function findTechnicianForUser(orgId: string, userId: string) {
  return prisma.repairTechnician.findFirst({
    where: { orgId, userId, isActive: true },
  });
}
