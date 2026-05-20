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
  categoryId?: string | null;
  assignedTechId?: string | null;
  query?: string | null;
}

export async function countTicketsByStatus(orgId: string) {
  const counts = await prisma.repairTicket.groupBy({
    by: ["status"],
    where: { orgId },
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

export async function countTicketsByUrgency(orgId: string, openOnly = true) {
  const counts = await prisma.repairTicket.groupBy({
    by: ["urgency"],
    where: openOnly
      ? { orgId, status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] } }
      : { orgId },
    _count: { _all: true },
  });
  const map: Record<RepairUrgency, number> = { URGENT: 0, NORMAL: 0, LOW: 0 };
  for (const c of counts) map[c.urgency] = c._count._all;
  return map;
}

export async function sumOpenCost(orgId: string) {
  const r = await prisma.repairTicket.aggregate({
    where: {
      orgId,
      status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED"] },
      createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    },
    _sum: { partsCostCents: true, laborCostCents: true },
  });
  return (r._sum.partsCostCents ?? 0) + (r._sum.laborCostCents ?? 0);
}

export async function listTickets(filters: TicketListFilters, limit = 50) {
  const where: Record<string, unknown> = { orgId: filters.orgId };
  if (filters.status) where.status = filters.status;
  if (filters.urgency) where.urgency = filters.urgency;
  if (filters.branchId) where.branchId = filters.branchId;
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
