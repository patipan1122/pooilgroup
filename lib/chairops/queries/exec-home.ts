// Exec home query (W1 · claude-design Phase 2 · mockup-100% rebuild 2026-05-28)
// Spec: /tmp/chairops-bigfeature/MOCKUP_SPEC.md §B Dashboard + GOAL_LOCK.md
// Audit ref: docs/AUDIT_chairops_2026-05-25.md §3 row "/chairops (executive home)"
//
// Returns the data the CEO scans in 10 minutes every morning, matching the
// supplied mockup `screens/dashboard.jsx` 100%:
//   1. ยอดขาย POS วันนี้ (+ delta vs 7-day avg)
//   2. ฝากแม่บ้านวันนี้ (+ X/30 สาขาส่งแล้ว)
//   3. DRIFT รวม (POS − ฝาก · positive = shortage = danger)
//   4. แม่บ้านยังไม่ส่ง (count + cut-off countdown)
//   5. กำไร 30 วัน (+ delta vs prior 30 days · after branch cost)
//
// Plus:
//   - `branches` (drift-engine rows) for the leaderboard
//   - getCriticalBranches() — top-N by drift desc, w/ 7-day POS sparkline series
//   - getMissedMaidsToday() — maids who haven't deposited today (cut-off 17:00)
//   - getRecentAlerts() — top-5 OPEN/ACK alerts by severity
//   - getSystemStatus() — last POS import + today's import count + today's events
//
// Every query filters `orgId = session.user.orgId` (multi-tenant per GOAL_LOCK).
// Per-request lookups wrapped in React `cache()` per
// [[react-cache-on-getsession-pattern]].

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getDashboardRows } from "@/lib/chairops/reconcile/drift-engine";
import {
  ChairopsAlertLevel,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";

// Maid cash cut-off (mockup: "ตัด cut-off 17:00").
export const MAID_CUTOFF_HOUR = 17;

// Bangkok day boundary helper — naive local midnight (matches legacy dashboard).
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDaysAgo(days: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - days);
  return d;
}

function decToNum(d: { toNumber: () => number } | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return d.toNumber();
}

// ----------------------------------------------------------------
// KPIs (5 tiles) + deltas
// ----------------------------------------------------------------
export interface ExecHomeKpis {
  todayPosRevenue: number;
  /** % change vs trailing 7-day average daily POS · null if no history. */
  posDeltaPct: number | null;
  todayDepositTotal: number;
  /** Count of branches that deposited today. */
  depositedBranchCount: number;
  cumulativeDriftTotal: number;
  /** Sum of shortage-days across active branches (for "X วันสาขา-วัน"). */
  shortageBranchDays: number;
  shortageBranchCount: number;
  /** Maids who have NOT deposited today (cut-off 17:00). */
  missedMaidCount: number;
  criticalOpenAlertCount: number;
  profit30d: number;
  /** % change vs prior 30-day window · null if no history. */
  profit30dDeltaPct: number | null;
  activeBranchCount: number;
  /** Pre-sorted by shortage size desc (largest drift first). */
  branches: Awaited<ReturnType<typeof getDashboardRows>>;
  computedAt: Date;
}

export const getExecHomeKpis = cache(async function getExecHomeKpis(
  orgId: string,
): Promise<ExecHomeKpis> {
  const today = startOfToday();
  const sevenDaysAgo = startOfDaysAgo(7);
  const thirtyDaysAgo = startOfDaysAgo(30);
  const sixtyDaysAgo = startOfDaysAgo(60);

  const [
    rows,
    posTodayAgg,
    posTrailing7Agg,
    depositAgg,
    depositedBranches,
    criticalAlertCount,
    pos30Agg,
    posPrior30Agg,
  ] = await Promise.all([
    getDashboardRows(orgId),
    // Today's POS gross (cash + online) for the org.
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: today } },
      _sum: { grossTotal: true },
    }),
    // Trailing 7 days (excluding today) → average daily.
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { grossTotal: true },
    }),
    prisma.chairopsCashCollection.aggregate({
      where: { orgId, collectedAt: { gte: today } },
      _sum: { depositedAmount: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: { orgId, collectedAt: { gte: today } },
      select: { branchId: true },
      distinct: ["branchId"],
    }),
    prisma.chairopsAlert.count({
      where: {
        orgId,
        status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        level: ChairopsAlertLevel.CRITICAL,
      },
    }),
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: thirtyDaysAgo } },
      _sum: { grossTotal: true },
    }),
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      _sum: { grossTotal: true },
    }),
  ]);

  const activeRows = rows.filter((r) => r.isActive);
  const shortageBranchCount = activeRows.filter(
    (r) => r.driftAmount > 0 && r.driftHours >= 24,
  ).length;
  const cumulativeDriftTotal = activeRows.reduce(
    (sum, r) => sum + (r.driftAmount > 0 ? r.driftAmount : 0),
    0,
  );
  const shortageBranchDays = activeRows.reduce(
    (sum, r) => sum + (r.driftAmount > 0 ? Math.floor(r.driftHours / 24) : 0),
    0,
  );

  // Missed maids = active branches that have NOT deposited today.
  const depositedSet = new Set(depositedBranches.map((b) => b.branchId));
  const missedMaidCount = activeRows.filter(
    (r) => !depositedSet.has(r.branchId),
  ).length;

  const todayPosRevenue = decToNum(posTodayAgg._sum?.grossTotal);
  const trailing7Total = decToNum(posTrailing7Agg._sum?.grossTotal);
  const avgDaily7 = trailing7Total / 7;
  const posDeltaPct =
    avgDaily7 > 0 ? ((todayPosRevenue - avgDaily7) / avgDaily7) * 100 : null;

  // 30-day "profit" proxy: gross POS in the window minus prorated branch costs.
  // Branch cost = monthly(rent+util+staff+other). Cost fields are admin-only and
  // may be null → treated as 0. This matches the mockup KPI "กำไร 30 วัน · หลังหักต้นทุนสาขา".
  const costRows = await prisma.chairopsBranch.findMany({
    where: { orgId, isActive: true },
    select: {
      monthlyRent: true,
      monthlyUtility: true,
      monthlyStaff: true,
      monthlyOther: true,
    },
  });
  const monthlyCostTotal = costRows.reduce(
    (sum, b) =>
      sum +
      decToNum(b.monthlyRent) +
      decToNum(b.monthlyUtility) +
      decToNum(b.monthlyStaff) +
      decToNum(b.monthlyOther),
    0,
  );
  const gross30 = decToNum(pos30Agg._sum?.grossTotal);
  const grossPrior30 = decToNum(posPrior30Agg._sum?.grossTotal);
  const profit30d = gross30 - monthlyCostTotal;
  const profitPrior30 = grossPrior30 - monthlyCostTotal;
  const profit30dDeltaPct =
    profitPrior30 > 0
      ? ((profit30d - profitPrior30) / profitPrior30) * 100
      : null;

  const branches = [...rows].sort((a, b) => b.driftAmount - a.driftAmount);

  return {
    todayPosRevenue,
    posDeltaPct,
    todayDepositTotal: depositAgg._sum?.depositedAmount ?? 0,
    depositedBranchCount: depositedBranches.length,
    cumulativeDriftTotal,
    shortageBranchDays,
    shortageBranchCount,
    missedMaidCount,
    criticalOpenAlertCount: criticalAlertCount,
    profit30d,
    profit30dDeltaPct,
    activeBranchCount: activeRows.length,
    branches,
    computedAt: new Date(),
  };
});

// ----------------------------------------------------------------
// Critical branches table (LEFT card) — top-N by drift desc + 7d sparkline.
// ----------------------------------------------------------------
export interface CriticalBranchRow {
  branchId: string;
  branchName: string;
  maidName: string | null;
  posToday: number;
  depositToday: number;
  /** drift-engine convention: positive = shortage. */
  drift: number;
  driftHours: number;
  lastCollectionAt: Date | null;
  daysSinceLastCollection: number;
  status: "ok" | "warn" | "critical" | "missed";
  /** 7-day POS daily series (oldest → newest) for the sparkbar. */
  posSeries: number[];
}

function classifyBranch(
  drift: number,
  driftHours: number,
  daysSince: number,
): CriticalBranchRow["status"] {
  if (daysSince > 1) return "missed";
  if (drift > 0 && driftHours >= 24) return "critical";
  if (drift > 0) return "warn";
  return "ok";
}

export const getCriticalBranches = cache(async function getCriticalBranches(
  orgId: string,
  opts: { take?: number } = {},
): Promise<CriticalBranchRow[]> {
  const take = opts.take ?? 8;
  const rows = await getDashboardRows(orgId);
  const active = rows.filter((r) => r.isActive);

  // Sort: shortage first (drift desc), then by days-since-collection desc.
  const sorted = [...active].sort((a, b) => {
    if (b.driftAmount !== a.driftAmount) return b.driftAmount - a.driftAmount;
    return b.daysSinceLastCollection - a.daysSinceLastCollection;
  });
  const top = sorted.slice(0, take);
  if (top.length === 0) return [];

  const branchIds = top.map((r) => r.branchId);
  const today = startOfToday();
  const sevenDaysAgo = startOfDaysAgo(6); // 7 buckets incl. today

  const [maids, posTodayRows, depositTodayRows, posSeriesRows] =
    await Promise.all([
      // 1 maid : 1 branch (primaryBranchId) per [[chairops-maid-one-per-branch-collect-only]]
      prisma.chairopsUser.findMany({
        where: {
          orgId,
          role: "MAID",
          primaryBranchId: { in: branchIds },
        },
        select: { displayName: true, primaryBranchId: true },
      }),
      prisma.chairopsPosDaily.groupBy({
        by: ["branchId"],
        where: { orgId, branchId: { in: branchIds }, bizDate: { gte: today } },
        _sum: { grossTotal: true },
      }),
      prisma.chairopsCashCollection.groupBy({
        by: ["branchId"],
        where: {
          orgId,
          branchId: { in: branchIds },
          collectedAt: { gte: today },
        },
        _sum: { depositedAmount: true },
      }),
      prisma.chairopsPosDaily.groupBy({
        by: ["branchId", "bizDate"],
        where: {
          orgId,
          branchId: { in: branchIds },
          bizDate: { gte: sevenDaysAgo },
        },
        _sum: { grossTotal: true },
      }),
    ]);

  const maidByBranch = new Map(
    maids
      .filter((m) => m.primaryBranchId)
      .map((m) => [m.primaryBranchId as string, m.displayName]),
  );
  const posTodayByBranch = new Map(
    posTodayRows.map((r) => [r.branchId, decToNum(r._sum?.grossTotal)]),
  );
  const depositTodayByBranch = new Map(
    depositTodayRows.map((r) => [r.branchId, r._sum?.depositedAmount ?? 0]),
  );

  // Build 7-day buckets (oldest → newest) keyed by ISO date.
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    dayKeys.push(startOfDaysAgo(i).toISOString().slice(0, 10));
  }
  const seriesByBranch = new Map<string, Map<string, number>>();
  for (const r of posSeriesRows) {
    const key = new Date(r.bizDate).toISOString().slice(0, 10);
    const m = seriesByBranch.get(r.branchId) ?? new Map<string, number>();
    m.set(key, decToNum(r._sum?.grossTotal));
    seriesByBranch.set(r.branchId, m);
  }

  return top.map((r) => {
    const series = seriesByBranch.get(r.branchId) ?? new Map();
    const posSeries = dayKeys.map((k) => series.get(k) ?? 0);
    return {
      branchId: r.branchId,
      branchName: r.branchName,
      maidName: maidByBranch.get(r.branchId) ?? null,
      posToday: posTodayByBranch.get(r.branchId) ?? 0,
      depositToday: depositTodayByBranch.get(r.branchId) ?? 0,
      drift: r.driftAmount,
      driftHours: r.driftHours,
      lastCollectionAt: r.lastCollectionAt,
      daysSinceLastCollection: r.daysSinceLastCollection,
      status: classifyBranch(
        r.driftAmount,
        r.driftHours,
        r.daysSinceLastCollection,
      ),
      posSeries,
    };
  });
});

// ----------------------------------------------------------------
// Missed maids today (RIGHT card) — branches with no deposit today.
// ----------------------------------------------------------------
export interface MissedMaidRow {
  branchId: string;
  branchName: string;
  maidName: string | null;
  maidPhone: string | null;
  posToday: number;
  status: "ok" | "warn" | "critical" | "missed";
}

export const getMissedMaidsToday = cache(async function getMissedMaidsToday(
  orgId: string,
  opts: { take?: number } = {},
): Promise<MissedMaidRow[]> {
  const take = opts.take ?? 5;
  const rows = await getDashboardRows(orgId);
  const active = rows.filter((r) => r.isActive);
  const today = startOfToday();

  const depositedBranches = await prisma.chairopsCashCollection.findMany({
    where: { orgId, collectedAt: { gte: today } },
    select: { branchId: true },
    distinct: ["branchId"],
  });
  const depositedSet = new Set(depositedBranches.map((b) => b.branchId));

  // Missed = active + no deposit today · worst drift first.
  const missed = active
    .filter((r) => !depositedSet.has(r.branchId))
    .sort((a, b) => b.driftAmount - a.driftAmount)
    .slice(0, take);
  if (missed.length === 0) return [];

  const branchIds = missed.map((r) => r.branchId);
  const [maids, posTodayRows] = await Promise.all([
    prisma.chairopsUser.findMany({
      where: { orgId, role: "MAID", primaryBranchId: { in: branchIds } },
      select: { displayName: true, phone: true, primaryBranchId: true },
    }),
    prisma.chairopsPosDaily.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { in: branchIds }, bizDate: { gte: today } },
      _sum: { grossTotal: true },
    }),
  ]);
  const maidByBranch = new Map(
    maids
      .filter((m) => m.primaryBranchId)
      .map((m) => [m.primaryBranchId as string, m]),
  );
  const posTodayByBranch = new Map(
    posTodayRows.map((r) => [r.branchId, decToNum(r._sum?.grossTotal)]),
  );

  return missed.map((r) => {
    const maid = maidByBranch.get(r.branchId);
    return {
      branchId: r.branchId,
      branchName: r.branchName,
      maidName: maid?.displayName ?? null,
      maidPhone: maid?.phone ?? null,
      posToday: posTodayByBranch.get(r.branchId) ?? 0,
      status: classifyBranch(
        r.driftAmount,
        r.driftHours,
        r.daysSinceLastCollection,
      ),
    };
  });
});

// ----------------------------------------------------------------
// Recent alerts (RIGHT card, below missed maids) — top-5 by severity.
// ----------------------------------------------------------------
export const getRecentAlerts = cache(async function getRecentAlerts(
  orgId: string,
  opts: { take?: number } = {},
) {
  return prisma.chairopsAlert.findMany({
    where: {
      orgId,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
    },
    orderBy: [{ level: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 5,
    include: { branch: { select: { name: true, slug: true, id: true } } },
  });
});

// ----------------------------------------------------------------
// System status footer — last POS import + today's import count + events.
// (No cron-run table exists yet · cron timings are static labels in the UI.)
// ----------------------------------------------------------------
export interface SystemStatus {
  lastPosImportAt: Date | null;
  posImportsToday: number;
  eventsToday: number;
}

export const getSystemStatus = cache(async function getSystemStatus(
  orgId: string,
): Promise<SystemStatus> {
  const today = startOfToday();
  const [lastImport, importsToday, eventsToday] = await Promise.all([
    prisma.chairopsPosImport.findFirst({
      where: { orgId, committed: true },
      orderBy: { uploadedAt: "desc" },
      select: { uploadedAt: true },
    }),
    prisma.chairopsPosImport.count({
      where: { orgId, uploadedAt: { gte: today } },
    }),
    prisma.chairopsAuditLog.count({
      where: { orgId, createdAt: { gte: today } },
    }),
  ]);
  return {
    lastPosImportAt: lastImport?.uploadedAt ?? null,
    posImportsToday: importsToday,
    eventsToday,
  };
});
