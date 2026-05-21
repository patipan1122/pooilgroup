// ClawFleet — read queries (Server Component / Server Action read paths)
// Uses Pool prisma client. Branch-scoping applied per session role.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

/** Helper: build a where filter that restricts branches by role */
async function branchScopedWhere(
  session: Session,
): Promise<{ orgId: string; branchId?: { in: string[] } }> {
  const bs = await userBranchIds(session);
  const base = { orgId: session.user.org_id };
  if (bs === "ALL") return base;
  return { ...base, branchId: { in: bs } };
}

// =============================================================
// Dashboard
// =============================================================
export const getDashboardKpis = cache(async () => {
  const session = await requireSession();
  const where = await branchScopedWhere(session);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 1. Today's cash collected (across all branches in scope)
  const todaySessions = await prisma.cfCollectionSession.aggregate({
    where: {
      orgId: session.user.org_id,
      group: where.branchId ? { branchId: where.branchId } : undefined,
      closedAt: { gte: todayStart },
      status: { in: ["CLOSED", "ANOMALY_REVIEW", "LOCKED"] },
    },
    _sum: { totalCashCents: true },
    _count: true,
  });

  // 2. Anomaly count (open ANOMALY_REVIEW)
  const anomalyCount = await prisma.cfCollectionSession.count({
    where: {
      orgId: session.user.org_id,
      group: where.branchId ? { branchId: where.branchId } : undefined,
      status: "ANOMALY_REVIEW",
    },
  });

  // 3. Stock alert (machines with last_doll_stock < 10)
  const lowStockMachines = await prisma.cfMachine.count({
    where: {
      ...where,
      kind: "CLAW",
      isActive: true,
      lastDollStock: { lt: 10 },
    },
  });

  // 4. Active machines
  const activeMachines = await prisma.cfMachine.count({
    where: { ...where, isActive: true },
  });

  return {
    cashTodayCents: todaySessions._sum.totalCashCents ?? 0,
    sessionsToday: todaySessions._count,
    anomalyCount,
    lowStockMachines,
    activeMachines,
  };
});

// =============================================================
// Machine list (admin)
// =============================================================
export async function listMachines(opts: {
  branchId?: string;
  kind?: "CLAW" | "EXCHANGER";
  search?: string;
}) {
  const session = await requireSession();
  const scoped = await branchScopedWhere(session);
  return prisma.cfMachine.findMany({
    where: {
      ...scoped,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.search
        ? {
            OR: [
              { code: { contains: opts.search, mode: "insensitive" as const } },
              { nickname: { contains: opts.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      group: { select: { id: true, name: true } },
    },
    orderBy: [{ branchId: "asc" }, { code: "asc" }],
    take: 500,
  });
}

// =============================================================
// Get machine detail by code
// =============================================================
export async function getMachineByCode(code: string) {
  const session = await requireSession();
  return prisma.cfMachine.findFirst({
    where: { orgId: session.user.org_id, code },
    include: {
      branch: true,
      group: true,
      loadouts: {
        where: { effectiveTo: null },
        include: { product: true },
        take: 1,
        orderBy: { effectiveFrom: "desc" },
      },
      exchangerLoadouts: {
        where: { effectiveTo: null },
        take: 1,
        orderBy: { effectiveFrom: "desc" },
      },
      events: {
        orderBy: { collectedAt: "desc" },
        take: 30,
      },
    },
  });
}

// =============================================================
// Groups list
// =============================================================
export async function listGroups() {
  const session = await requireSession();
  const scoped = await branchScopedWhere(session);
  return prisma.cfMachineGroup.findMany({
    where: { ...scoped, isActive: true },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      exchanger: { select: { id: true, code: true, lastCoinMeter: true } },
      machines: {
        where: { isActive: true, kind: "CLAW" },
        select: { id: true, code: true, nickname: true, lastCoinMeter: true, lastDollStock: true },
      },
      _count: { select: { machines: true, sessions: true } },
    },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
}

// =============================================================
// Group detail (for session start screen)
// =============================================================
export async function getGroupDetail(groupId: string) {
  const session = await requireSession();
  return prisma.cfMachineGroup.findFirst({
    where: { id: groupId, orgId: session.user.org_id },
    include: {
      branch: true,
      exchanger: {
        include: {
          exchangerLoadouts: {
            where: { effectiveTo: null },
            take: 1,
            orderBy: { effectiveFrom: "desc" },
          },
        },
      },
      machines: {
        where: { isActive: true },
        include: {
          loadouts: {
            where: { effectiveTo: null },
            include: { product: true },
            take: 1,
            orderBy: { effectiveFrom: "desc" },
          },
        },
        orderBy: { code: "asc" },
      },
    },
  });
}

// =============================================================
// Products
// =============================================================
export async function listProducts() {
  const session = await requireSession();
  return prisma.cfProduct.findMany({
    where: { orgId: session.user.org_id, isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

// =============================================================
// Sessions list
// =============================================================
export async function listSessions(opts: {
  status?: "OPEN" | "CLOSED" | "ANOMALY_REVIEW" | "LOCKED";
  groupId?: string;
  from?: Date;
  to?: Date;
  take?: number;
}) {
  const session = await requireSession();
  const scoped = await branchScopedWhere(session);
  return prisma.cfCollectionSession.findMany({
    where: {
      orgId: session.user.org_id,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.groupId ? { groupId: opts.groupId } : {}),
      ...(opts.from || opts.to
        ? { openedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
      ...(scoped.branchId
        ? { group: { branchId: scoped.branchId } }
        : {}),
    },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true, code: true } },
        },
      },
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      _count: { select: { events: true } },
    },
    orderBy: { openedAt: "desc" },
    take: opts.take ?? 100,
  });
}

// =============================================================
// Session detail (for collection page)
// =============================================================
export async function getSessionDetail(sessionId: string) {
  const session = await requireSession();
  return prisma.cfCollectionSession.findFirst({
    where: { id: sessionId, orgId: session.user.org_id },
    include: {
      group: {
        include: {
          branch: true,
          exchanger: true,
          machines: {
            where: { isActive: true },
            include: {
              loadouts: {
                where: { effectiveTo: null },
                include: { product: true },
                take: 1,
                orderBy: { effectiveFrom: "desc" },
              },
            },
            orderBy: { code: "asc" },
          },
        },
      },
      events: {
        include: {
          machine: { select: { id: true, code: true, nickname: true, kind: true } },
        },
        orderBy: { collectedAt: "asc" },
      },
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });
}

// =============================================================
// Open session for group (if exists)
// =============================================================
export async function getOpenSessionForGroup(groupId: string) {
  const session = await requireSession();
  return prisma.cfCollectionSession.findFirst({
    where: { orgId: session.user.org_id, groupId, status: "OPEN" },
    include: {
      _count: { select: { events: true } },
    },
  });
}

// =============================================================
// Anomaly review list
// =============================================================
export async function listAnomalies() {
  const session = await requireSession();
  const scoped = await branchScopedWhere(session);
  return prisma.cfCollectionSession.findMany({
    where: {
      orgId: session.user.org_id,
      status: "ANOMALY_REVIEW",
      ...(scoped.branchId ? { group: { branchId: scoped.branchId } } : {}),
    },
    include: {
      group: {
        select: {
          name: true,
          branch: { select: { name: true, code: true } },
        },
      },
      openedBy: { select: { name: true } },
      _count: { select: { events: true } },
    },
    orderBy: { closedAt: "desc" },
    take: 100,
  });
}

// =============================================================
// Stock — current balance per branch+product
// =============================================================
export async function getStockBalance(branchId: string) {
  const session = await requireSession();
  // sum signed qty for each product at this branch
  const rows = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId: session.user.org_id, branchId },
    _sum: { qty: true },
  });
  const productIds = rows.map((r) => r.productId);
  const products = await prisma.cfProduct.findMany({
    where: { orgId: session.user.org_id, id: { in: productIds } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows
    .map((r) => ({
      product: byId.get(r.productId)!,
      qty: r._sum.qty ?? 0,
    }))
    .filter((r) => r.product)
    .sort((a, b) => a.product.name.localeCompare(b.product.name, "th"));
}

// =============================================================
// Stock movements history (for receive/count page list)
// =============================================================
export async function listStockMovements(opts: { branchId?: string; type?: string; take?: number }) {
  const session = await requireSession();
  const scoped = await branchScopedWhere(session);
  return prisma.cfStockMovement.findMany({
    where: {
      ...scoped,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.type
        ? { type: opts.type as "RECEIVE" | "LOAD_TO_MACHINE" | "COUNT_SNAPSHOT" | "ADJUST" }
        : {}),
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, name: true } },
      machine: { select: { id: true, code: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: opts.take ?? 100,
  });
}

// =============================================================
// Get branches user can access
// =============================================================
export async function listAccessibleBranches() {
  const session = await requireSession();
  const bs = await userBranchIds(session);
  // Filter to claw_machine business type in BOTH paths
  // (J1-A: previously staff/manager bypass leaked fuel/depot branches into UI)
  const baseWhere = {
    orgId: session.user.org_id,
    isActive: true,
    businessType: "claw_machine" as const,
  };
  if (bs === "ALL") {
    return prisma.branch.findMany({ where: baseWhere, orderBy: { name: "asc" } });
  }
  return prisma.branch.findMany({
    where: { ...baseWhere, id: { in: bs } },
    orderBy: { name: "asc" },
  });
}

// =============================================================
// Report query — sessions + events with filters
// =============================================================
export async function getReportEvents(opts: {
  from: Date;
  to: Date;
  branchId?: string;
  machineId?: string;
}) {
  const session = await requireSession();
  const scoped = await branchScopedWhere(session);
  // P1-13 fix: opts.branchId must intersect with user's scope, not override it
  let effectiveBranchFilter: { in: string[] } | undefined;
  if (scoped.branchId) {
    if (opts.branchId) {
      // staff/manager passed branchId — only allow if in their scope
      effectiveBranchFilter = { in: scoped.branchId.in.includes(opts.branchId) ? [opts.branchId] : [] };
    } else {
      effectiveBranchFilter = scoped.branchId;
    }
  } else if (opts.branchId) {
    // admin tier: trust the requested branch
    effectiveBranchFilter = { in: [opts.branchId] };
  }
  return prisma.cfCollectionEvent.findMany({
    where: {
      orgId: session.user.org_id,
      collectedAt: { gte: opts.from, lte: opts.to },
      eventType: "COLLECTION",
      ...(opts.machineId ? { machineId: opts.machineId } : {}),
      ...(effectiveBranchFilter ? { machine: { branchId: effectiveBranchFilter } } : {}),
    },
    include: {
      machine: {
        select: {
          id: true,
          code: true,
          nickname: true,
          kind: true,
          branch: { select: { id: true, name: true, code: true } },
        },
      },
      collectedBy: { select: { id: true, name: true } },
      session: { select: { id: true, sessionCode: true, status: true } },
    },
    orderBy: { collectedAt: "desc" },
    take: 1000,
  });
}
