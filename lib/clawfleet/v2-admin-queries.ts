// ClawFleet v2 — admin-page server queries for Team/Audit/Settings pages.
// Org-scoped, branch-scoped (respects userBranchIds for non-admin viewers).

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import { DEFAULTS } from "./types";

// =============================================================
// Team & สาขา
// =============================================================

export type TeamMember = { id: string; name: string; email: string | null; role: string };
export type TeamBranchRow = {
  id: string;
  name: string;
  code: string;
  area: string;
  managerName: string | null;
  machinesCount: number;
  staff: TeamMember[];
};
export type TeamData = {
  totals: { branches: number; machines: number; staff: number; withManager: number };
  branches: TeamBranchRow[];
};

export async function getTeamData(): Promise<TeamData> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const allowed = await userBranchIds(session);

  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(allowed === "ALL" ? {} : { id: { in: allowed } }),
    },
    select: {
      id: true,
      name: true,
      code: true,
      province: true,
      region: true,
      manager: { select: { name: true } },
      _count: { select: { cfMachines: { where: { isActive: true } } } },
    },
    orderBy: { code: "asc" },
  });

  const branchIds = branches.map((b) => b.id);
  const ubs = branchIds.length
    ? await prisma.userBranch.findMany({
        where: { branchId: { in: branchIds } },
        select: {
          branchId: true,
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      })
    : [];

  const staffByBranch = new Map<string, TeamMember[]>();
  for (const u of ubs) {
    const list = staffByBranch.get(u.branchId) ?? [];
    list.push({
      id: u.user.id,
      name: u.user.name,
      email: u.user.email,
      role: u.user.role,
    });
    staffByBranch.set(u.branchId, list);
  }

  const branchRows: TeamBranchRow[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    area: b.province ?? b.region ?? "—",
    managerName: b.manager?.name ?? null,
    machinesCount: b._count.cfMachines,
    staff: staffByBranch.get(b.id) ?? [],
  }));

  const totals = {
    branches: branchRows.length,
    machines: branchRows.reduce((s, b) => s + b.machinesCount, 0),
    staff: new Set(ubs.map((u) => u.user.id)).size,
    withManager: branchRows.filter((b) => b.managerName).length,
  };

  return { totals, branches: branchRows };
}

// =============================================================
// Audit feed — derived from session reviews + stock moves + deliveries
// =============================================================

export type AuditAction = "approve" | "recheck" | "escalate" | "adjust" | "receive" | "delivery";
export type AuditEntry = {
  id: string;
  at: Date;
  action: AuditAction;
  actionLabel: string;
  actor: string;
  branchName: string;
  target: string;
  detail: string;
};

export async function getAuditFeed(limit = 50): Promise<AuditEntry[]> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const allowed = await userBranchIds(session);
  const branchScope = allowed === "ALL" ? undefined : { in: allowed };

  const [reviews, stockMoves, deliveries] = await Promise.all([
    prisma.cfCollectionSession.findMany({
      where: {
        orgId,
        reviewedAt: { not: null },
        ...(branchScope ? { branchId: branchScope } : {}),
      },
      select: {
        id: true,
        sessionCode: true,
        reviewedAt: true,
        reviewNote: true,
        status: true,
        reviewer: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { reviewedAt: "desc" },
      take: limit,
    }),
    prisma.cfStockMovement.findMany({
      where: {
        orgId,
        type: { in: ["ADJUST", "RECEIVE"] },
        ...(branchScope ? { branchId: branchScope } : {}),
      },
      select: {
        id: true,
        occurredAt: true,
        type: true,
        qty: true,
        reason: true,
        product: { select: { sku: true, name: true } },
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    prisma.cfDelivery.findMany({
      where: { orgId, ...(branchScope ? { branchId: branchScope } : {}) },
      select: {
        id: true,
        createdAt: true,
        status: true,
        itemsCount: true,
        unitsCount: true,
        fromLocation: true,
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const entries: AuditEntry[] = [];

  for (const r of reviews) {
    const isEscalate = (r.reviewNote ?? "").startsWith("[ESCALATE]");
    const action: AuditAction = isEscalate
      ? "escalate"
      : r.status === "LOCKED"
        ? "approve"
        : "recheck";
    entries.push({
      id: `rev-${r.id}`,
      at: r.reviewedAt!,
      action,
      actionLabel:
        action === "approve" ? "อนุมัติรอบ" : action === "recheck" ? "ส่งให้พนักงานตรวจซ้ำ" : "ส่งต่อผู้จัดการ",
      actor: r.reviewer?.name ?? "—",
      branchName: r.branch?.name ?? "—",
      target: r.sessionCode,
      detail: r.reviewNote ?? "",
    });
  }
  for (const s of stockMoves) {
    entries.push({
      id: `stk-${s.id}`,
      at: s.occurredAt,
      action: s.type === "ADJUST" ? "adjust" : "receive",
      actionLabel: s.type === "ADJUST" ? "ปรับสต๊อก" : "รับของเข้าคลัง",
      actor: s.createdBy.name,
      branchName: s.branch?.name ?? "—",
      target: `${s.product.name} (${s.product.sku})`,
      detail: `${s.qty > 0 ? "+" : ""}${s.qty} ตัว · ${s.reason ?? ""}`,
    });
  }
  for (const d of deliveries) {
    entries.push({
      id: `dlv-${d.id}`,
      at: d.createdAt,
      action: "delivery",
      actionLabel: "สั่งของจากคลังกลาง",
      actor: d.createdBy.name,
      branchName: d.branch.name,
      target: `${d.itemsCount} SKU · ${d.unitsCount} ตัว`,
      detail: `${d.fromLocation} · ${d.status}`,
    });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

// =============================================================
// Settings — current configuration snapshot
// =============================================================

export type SettingsData = {
  counts: { branches: number; machines: number; claws: number; exchangers: number; products: number };
  config: {
    groupTolerancePct: number;
    cashAcceptableBaht: number;
    cashWarnBaht: number;
    dollVarianceAcceptable: number;
    dollVariancePct: number;
    promoMaxPct: number;
    photoRetentionDays: number;
    sessionAutoCloseHours: number;
    baselineDays: number;
  };
};

export async function getSettingsData(): Promise<SettingsData> {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const [branches, machines, claws, exchangers, products] = await Promise.all([
    prisma.branch.count({ where: { orgId, businessType: "claw_machine", isActive: true } }),
    prisma.cfMachine.count({ where: { orgId, isActive: true } }),
    prisma.cfMachine.count({ where: { orgId, isActive: true, kind: "CLAW" } }),
    prisma.cfMachine.count({ where: { orgId, isActive: true, kind: "EXCHANGER" } }),
    prisma.cfProduct.count({ where: { orgId, isActive: true } }),
  ]);

  return {
    counts: { branches, machines, claws, exchangers, products },
    config: {
      groupTolerancePct: DEFAULTS.GROUP_TOLERANCE_BPS / 100,
      cashAcceptableBaht: DEFAULTS.CASH_VARIANCE_ACCEPTABLE_CENTS / 100,
      cashWarnBaht: DEFAULTS.CASH_VARIANCE_WARN_CENTS / 100,
      dollVarianceAcceptable: DEFAULTS.DOLL_VARIANCE_ACCEPTABLE,
      dollVariancePct: DEFAULTS.DOLL_VARIANCE_PCT * 100,
      promoMaxPct: DEFAULTS.PROMO_DISCOUNT_PCT_MAX * 100,
      photoRetentionDays: DEFAULTS.PHOTO_RETENTION_DAYS,
      sessionAutoCloseHours: DEFAULTS.SESSION_AUTO_CLOSE_HOURS,
      baselineDays: DEFAULTS.ANOMALY_BASELINE_DAYS,
    },
  };
}
