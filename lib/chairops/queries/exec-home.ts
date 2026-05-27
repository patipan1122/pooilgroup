// Exec home query (W1 · claude-design Phase 2)
// Spec: /tmp/claude-design_chairops_plan.md §W1 + §4.2
// Audit ref: docs/AUDIT_chairops_2026-05-25.md §3 row "/chairops (executive home)"
//
// Returns the 5 KPI scalars the CEO scans in 10 minutes every morning:
//   1. ยอดขาย POS วันนี้ (sum of today's posDaily.totalRevenue)
//   2. เงินฝากแม่บ้านวันนี้ (sum of today's collections.depositAmount)
//   3. ยอดขาดสุทธิ (sum drift across active branches · positive = shortage)
//   4. สาขามี shortage > 0 (count of active branches with positive aged drift)
//   5. Alerts P0 ค้าง (count of OPEN+ACK CRITICAL alerts)
//
// Plus a `branches` array (re-uses getDashboardRows shape) for the leaderboard.
//
// TODO[claude-design]: cache 30 min via React `cache()` once usage stabilises.
// Right now every render hits DB — fine while only the exec home calls it.

import { prisma } from "@/lib/prisma";
import { getDashboardRows } from "@/lib/chairops/reconcile/drift-engine";
import {
  ChairopsAlertLevel,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";

export interface ExecHomeKpis {
  todayPosRevenue: number;
  todayDepositTotal: number;
  cumulativeDriftTotal: number;
  shortageBranchCount: number;
  criticalOpenAlertCount: number;
  activeBranchCount: number;
  /** Pre-sorted by shortage size desc (largest drift first). */
  branches: Awaited<ReturnType<typeof getDashboardRows>>;
  /** Generated-at timestamp · displayed under the KPI strip. */
  computedAt: Date;
}

export async function getExecHomeKpis(): Promise<ExecHomeKpis> {
  // Asia/Bangkok day boundary — naive UTC midnight is acceptable for daily
  // aggregates (matches legacy dashboard/page.tsx behaviour).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // W0: chairopsPosDaily.totalRevenue → grossTotal (BA-2 rename · now Decimal(12,2))
  const [rows, posAgg, depositAgg, criticalAlertCount] = await Promise.all([
    getDashboardRows(),
    prisma.chairopsPosDaily.aggregate({
      where: { bizDate: { gte: todayStart } },
      _sum: { grossTotal: true },
    }),
    prisma.chairopsCashCollection.aggregate({
      where: { collectedAt: { gte: todayStart } },
      _sum: { depositedAmount: true },
    }),
    prisma.chairopsAlert.count({
      where: {
        status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        level: ChairopsAlertLevel.CRITICAL,
      },
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

  // Leaderboard: worst-shortage first · already sorted by getDashboardRows desc
  // but re-sort defensively in case upstream changes.
  const branches = [...rows].sort((a, b) => b.driftAmount - a.driftAmount);

  // grossTotal aggregate is Prisma.Decimal | null · convert for UI consumption.
  const todayPosRevenue = posAgg._sum?.grossTotal
    ? Number(posAgg._sum.grossTotal)
    : 0;

  return {
    todayPosRevenue,
    todayDepositTotal: depositAgg._sum?.depositedAmount ?? 0,
    cumulativeDriftTotal,
    shortageBranchCount,
    criticalOpenAlertCount: criticalAlertCount,
    activeBranchCount: activeRows.length,
    branches,
    computedAt: new Date(),
  };
}
