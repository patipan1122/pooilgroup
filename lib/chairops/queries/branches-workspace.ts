// ============================================================
// Branches Workspace queries (Branches 3-pane screen · SPEC §B/Branches)
// ============================================================
// Server-only data layer for /chairops/branches:
//   - getBranchesWorkspace({ view, mall, sortBy }) → list rows + KPIs + 7d series
//   - getBranchDetail(branchId) → full right-pane detail bundle
//
// All reads filter by the session's orgId (Pool multi-tenant · no hardcoded
// org). Drift/status comes from the ChairopsDrift cache (same source the
// dashboard uses) so the workspace stays in sync without recompute.
//
// References:
//   [[chairops-no-cumulative-shortage]] · [[chairops-maid-one-per-branch-collect-only]]
//   [[react-cache-on-getsession-pattern]] — callers already cache getSession.
// ============================================================

import { prisma } from "@/lib/prisma";
import { ageHours, ageDays } from "@/lib/chairops/utils/format";
import { resolveMall } from "@/lib/chairops/utils/mall-groups";
import {
  deriveStatus,
  type BranchStatus,
} from "@/app/(admin)/chairops/dashboard/_components/status-badge";

// Mockup status vocabulary (ok | warn | critical | missed) used by the rail
// filter + status dots. We collapse the richer engine status into it.
export type WorkspaceStatus = "ok" | "warn" | "critical" | "missed";

export function toWorkspaceStatus(s: BranchStatus): WorkspaceStatus {
  switch (s) {
    case "missed":
      return "missed";
    case "shortage":
      return "critical";
    case "watch":
    case "surplus":
      return "warn";
    case "inactive":
    case "ok":
    default:
      return "ok";
  }
}

export type WorkspaceView = "all" | "critical" | "warn" | "ok" | "missed";
export type WorkspaceSort =
  | "priority"
  | "drift"
  | "missed"
  | "pos"
  | "profit"
  | "name";

export interface BranchRowVM {
  branchId: string;
  branchSlug: string;
  name: string;
  mallKey: string;
  mallLabel: string;
  mallColor: string;
  maidName: string;
  chairs: number;
  lastCollectionAt: Date | null;
  daysSinceCollect: number;
  drift: number;
  status: WorkspaceStatus;
  /** 7-day cash-deposit series for the sparkbar (oldest → newest). */
  series: number[];
  posToday: number;
  profit30d: number;
}

export interface BranchesWorkspaceVM {
  rows: BranchRowVM[];
  counts: {
    all: number;
    critical: number;
    warn: number;
    ok: number;
    missed: number;
  };
  mallCounts: Record<string, number>;
}

const SERIES_DAYS = 7;

function startOfDayMinus(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

// ----------------------------------------------------------------
// List query
// ----------------------------------------------------------------
export async function getBranchesWorkspace(args: {
  orgId: string;
  view?: WorkspaceView;
  mall?: string;
  sortBy?: WorkspaceSort;
}): Promise<BranchesWorkspaceVM> {
  const { orgId } = args;
  const view = args.view ?? "all";
  const mall = args.mall ?? "all";
  const sortBy = args.sortBy ?? "priority";

  const since = startOfDayMinus(SERIES_DAYS);

  const [branches, drifts, maidAssignments, chairCounts, collections] =
    await Promise.all([
      prisma.chairopsBranch.findMany({
        where: { orgId },
        orderBy: { name: "asc" },
      }),
      prisma.chairopsDrift.findMany({ where: { orgId } }),
      // Active maid per branch (1:1 · collect-only)
      prisma.chairopsMaidAssignment.findMany({
        where: { orgId, isActive: true },
        include: { user: { select: { displayName: true } } },
      }),
      prisma.chairopsChair.groupBy({
        by: ["branchId"],
        where: { orgId, isActive: true },
        _count: { _all: true },
      }),
      // 7-day deposit history for the sparkbar (all branches at once)
      prisma.chairopsCashCollection.findMany({
        where: { orgId, collectedAt: { gte: since } },
        select: { branchId: true, depositedAmount: true, collectedAt: true },
      }),
    ]);

  const driftByBranch = new Map(drifts.map((d) => [d.branchId, d]));
  const maidByBranch = new Map(
    maidAssignments.map((a) => [a.branchId, a.user?.displayName ?? "—"]),
  );
  const chairByBranch = new Map(
    chairCounts.map((c) => [c.branchId, c._count._all]),
  );

  // Bucket deposits into per-branch 7-day arrays (index 0 = oldest day).
  const seriesByBranch = new Map<string, number[]>();
  for (const c of collections) {
    const dayIdx =
      SERIES_DAYS -
      1 -
      Math.floor((Date.now() - c.collectedAt.getTime()) / 86_400_000);
    if (dayIdx < 0 || dayIdx >= SERIES_DAYS) continue;
    const arr = seriesByBranch.get(c.branchId) ?? new Array(SERIES_DAYS).fill(0);
    arr[dayIdx] += c.depositedAmount;
    seriesByBranch.set(c.branchId, arr);
  }

  let rows: BranchRowVM[] = branches.map((b) => {
    const d = driftByBranch.get(b.id);
    const driftAmount = d?.driftAmount ?? 0;
    const driftHours = d?.driftSince ? ageHours(d.driftSince) : 0;
    const lastCollectionAt = d?.lastCollectionAt ?? null;
    const daysSinceCollect = lastCollectionAt ? ageDays(lastCollectionAt) : 999;
    const engineStatus = deriveStatus({
      isActive: b.isActive,
      driftAmount,
      driftHours,
      daysSinceLastCollection: daysSinceCollect,
    });
    const mall = resolveMall(b.mallGroup);
    const posTotal = d?.posTotal ?? 0;
    const depositTotal = d?.depositTotal ?? 0;
    // Lightweight 30d profit proxy = deposits − monthly cost (admin sees real
    // cost; this proxy only drives the "profit" sort, never shown unguarded).
    const cost =
      Number(b.monthlyRent ?? 0) +
      Number(b.monthlyUtility ?? 0) +
      Number(b.monthlyStaff ?? 0) +
      Number(b.monthlyOther ?? 0);
    return {
      branchId: b.id,
      branchSlug: b.slug,
      name: b.name,
      mallKey: mall.key,
      mallLabel: mall.label,
      mallColor: mall.color,
      maidName: maidByBranch.get(b.id) ?? "—",
      chairs: chairByBranch.get(b.id) ?? 0,
      lastCollectionAt,
      daysSinceCollect,
      drift: driftAmount,
      status: toWorkspaceStatus(engineStatus),
      series: seriesByBranch.get(b.id) ?? new Array(SERIES_DAYS).fill(0),
      posToday: posTotal,
      profit30d: depositTotal - cost,
    };
  });

  // counts BEFORE filtering (rail always shows full population)
  const counts = {
    all: rows.length,
    critical: rows.filter((r) => r.status === "critical").length,
    warn: rows.filter((r) => r.status === "warn").length,
    ok: rows.filter((r) => r.status === "ok").length,
    missed: rows.filter((r) => r.status === "missed").length,
  };
  const mallCounts: Record<string, number> = {};
  for (const r of rows) mallCounts[r.mallKey] = (mallCounts[r.mallKey] ?? 0) + 1;

  // apply filters
  rows = rows.filter((r) => {
    if (view !== "all" && r.status !== view) return false;
    if (mall !== "all" && r.mallKey !== mall) return false;
    return true;
  });

  // sort
  const prio = (s: WorkspaceStatus) =>
    s === "critical" ? 0 : s === "missed" ? 1 : s === "warn" ? 2 : 3;
  rows.sort((a, b) => {
    switch (sortBy) {
      case "priority":
        return prio(a.status) - prio(b.status) || a.drift - b.drift;
      case "drift":
        return b.drift - a.drift;
      case "missed":
        return b.daysSinceCollect - a.daysSinceCollect;
      case "pos":
        return b.posToday - a.posToday;
      case "profit":
        return b.profit30d - a.profit30d;
      case "name":
        return a.name.localeCompare(b.name, "th");
      default:
        return 0;
    }
  });

  return { rows, counts, mallCounts };
}

// ----------------------------------------------------------------
// Detail bundle
// ----------------------------------------------------------------
export interface BranchDetailVM {
  branchId: string;
  branchSlug: string;
  name: string;
  mallKey: string;
  mallLabel: string;
  mallColor: string;
  province: string | null;
  chairs: number;
  status: WorkspaceStatus;
  posToday: number;
  depositToday: number;
  drift: number;
  driftHours: number;
  profit30d: number;
  lastCollectionAt: Date | null;
  daysSinceCollect: number;
  shortageDays: number;
  maid: { name: string; phone: string | null; sinceLabel: string } | null;
  cost: {
    rent: number;
    util: number;
    payroll: number;
    misc: number;
    total: number;
    daily: number;
  };
  alerts: {
    id: string;
    severity: "critical" | "warn" | "info";
    title: string;
    detail: string;
    age: string;
  }[];
  series: { pos: number[]; deposit: number[] };
  chairList: { code: string; isDamaged: boolean }[];
  openDamageCount: number;
}

function ageLabel(d: Date | null): string {
  if (!d) return "—";
  const days = ageDays(d);
  if (days <= 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  return `${days} วันก่อน`;
}

const ALERT_LEVEL_MAP: Record<string, "critical" | "warn" | "info"> = {
  CRITICAL: "critical",
  WARN: "warn",
  INFO: "info",
};

export async function getBranchDetail(args: {
  orgId: string;
  branchId: string;
}): Promise<BranchDetailVM | null> {
  const { orgId, branchId } = args;

  const branch = await prisma.chairopsBranch.findFirst({
    where: { orgId, id: branchId },
  });
  if (!branch) return null;

  const since = startOfDayMinus(SERIES_DAYS);

  const [
    drift,
    maidAssignment,
    chairs,
    openDamage,
    alerts,
    deposits7d,
    posDaily7d,
  ] = await Promise.all([
    prisma.chairopsDrift.findFirst({ where: { orgId, branchId } }),
    prisma.chairopsMaidAssignment.findFirst({
      where: { orgId, branchId, isActive: true },
      include: { user: { select: { displayName: true, phone: true } } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.chairopsChair.findMany({
      where: { orgId, branchId, isActive: true },
      orderBy: { chairCode: "asc" },
    }),
    prisma.chairopsDamageTicket.findMany({
      where: {
        orgId,
        branchId,
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] },
      },
      select: { id: true, chairId: true },
    }),
    prisma.chairopsAlert.findMany({
      where: { orgId, branchId, status: { in: ["OPEN", "ACK"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.chairopsCashCollection.findMany({
      where: { orgId, branchId, collectedAt: { gte: since } },
      select: { depositedAmount: true, collectedAt: true },
    }),
    prisma.chairopsBranchDailyRevenue.findMany({
      where: { orgId, branchId, bizDate: { gte: since } },
      select: { cashTotal: true, bizDate: true },
    }),
  ]);

  const driftAmount = drift?.driftAmount ?? 0;
  const driftHours = drift?.driftSince ? ageHours(drift.driftSince) : 0;
  const lastCollectionAt = drift?.lastCollectionAt ?? null;
  const daysSinceCollect = lastCollectionAt ? ageDays(lastCollectionAt) : 999;
  const engineStatus = deriveStatus({
    isActive: branch.isActive,
    driftAmount,
    driftHours,
    daysSinceLastCollection: daysSinceCollect,
  });
  const mall = resolveMall(branch.mallGroup);

  // 7-day series (index 0 = oldest)
  const depSeries = new Array(SERIES_DAYS).fill(0);
  for (const c of deposits7d) {
    const i =
      SERIES_DAYS -
      1 -
      Math.floor((Date.now() - c.collectedAt.getTime()) / 86_400_000);
    if (i >= 0 && i < SERIES_DAYS) depSeries[i] += c.depositedAmount;
  }
  const posSeries = new Array(SERIES_DAYS).fill(0);
  for (const p of posDaily7d) {
    const i =
      SERIES_DAYS -
      1 -
      Math.floor((Date.now() - p.bizDate.getTime()) / 86_400_000);
    if (i >= 0 && i < SERIES_DAYS) posSeries[i] += Number(p.cashTotal);
  }

  const damagedChairIds = new Set(
    openDamage.map((t) => t.chairId).filter(Boolean) as string[],
  );

  const rent = Number(branch.monthlyRent ?? 0);
  const util = Number(branch.monthlyUtility ?? 0);
  const payroll = Number(branch.monthlyStaff ?? 0);
  const misc = Number(branch.monthlyOther ?? 0);
  const total = rent + util + payroll + misc;

  return {
    branchId: branch.id,
    branchSlug: branch.slug,
    name: branch.name,
    mallKey: mall.key,
    mallLabel: mall.label,
    mallColor: mall.color,
    province: branch.city,
    chairs: chairs.length,
    status: toWorkspaceStatus(engineStatus),
    posToday: drift?.posTotal ?? 0,
    depositToday: drift?.depositTotal ?? 0,
    drift: driftAmount,
    driftHours,
    profit30d: (drift?.depositTotal ?? 0) - total,
    lastCollectionAt,
    daysSinceCollect,
    shortageDays: driftAmount > 0 ? Math.max(1, Math.round(driftHours / 24)) : 0,
    maid: maidAssignment
      ? {
          name: maidAssignment.user?.displayName ?? "—",
          phone: maidAssignment.user?.phone ?? null,
          sinceLabel: `ผูก 1:1 ตั้งแต่ ${ageLabel(maidAssignment.startedAt)}`,
        }
      : null,
    cost: {
      rent,
      util,
      payroll,
      misc,
      total,
      daily: total ? Math.round(total / 30) : 0,
    },
    alerts: alerts.map((a) => ({
      id: a.id,
      severity: ALERT_LEVEL_MAP[a.level] ?? "info",
      title: a.title,
      detail: a.message,
      age: ageLabel(a.createdAt),
    })),
    series: { pos: posSeries, deposit: depSeries },
    chairList: chairs.map((c) => ({
      code: c.chairCode,
      isDamaged: damagedChairIds.has(c.id),
    })),
    openDamageCount: openDamage.length,
  };
}
