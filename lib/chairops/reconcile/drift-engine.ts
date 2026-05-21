// ============================================================
// Plan K — Cumulative Drift Engine
// ============================================================
// Per memory [[chairops-maid-schedule-irregular]] + [[chairops-no-cumulative-shortage]]
//
// Logic:
//   drift = ΣPOS − Σmaid_deposits  (per branch)
//
//   - drift > 0  = uncollected cash OR shortage (need to find out which)
//   - drift ~= 0 = caught up (good)
//   - drift < 0  = surplus (maid deposited more than POS · tip/promo?)
//
// Two independent alarm rules:
//   A) money:  drift > THRESHOLD_BAHT AND aged > THRESHOLD_HOURS → SHORTAGE alert
//   B) cadence: days since last collection > MAX_DAYS → MISSED_COLLECTION alert
//
// "Zero tolerance" = THRESHOLD_BAHT = 0 → any positive drift aged > 24h alerts.
// (Tunable per branch later if CEO wants finer policy.)
// ============================================================

import { prisma } from "@/lib/prisma";
import { ageHours, ageDays } from "@/lib/chairops/utils/format";

// Defaults — can be overridden per branch via env/config table later
export const DRIFT_DEFAULTS = {
  shortageThresholdBaht: 0, // zero tolerance per CEO
  shortageAgeHoursToAlert: 24,
  surplusToleranceBaht: 100, // surplus < 100฿ = noise, ignore (tip)
  maxDaysSinceCollection: 1, // alert if maid hasn't collected in 1+ day
} as const;

export interface BranchDriftSnapshot {
  branchId: string;
  branchName: string;
  posTotal: number;
  depositTotal: number;
  driftAmount: number;
  driftHours: number;
  lastCollectionAt: Date | null;
  daysSinceLastCollection: number;
  status: "ok" | "watch" | "shortage" | "surplus" | "missed";
}

export async function recomputeDriftForBranch(branchId: string): Promise<BranchDriftSnapshot> {
  const branch = await prisma.chairopsBranch.findUniqueOrThrow({ where: { id: branchId } });

  const [posAgg, depositAgg, lastCollection, lastPos] = await Promise.all([
    prisma.chairopsPosDaily.aggregate({
      where: { branchId },
      _sum: { totalRevenue: true },
    }),
    prisma.chairopsCashCollection.aggregate({
      where: { branchId },
      _sum: { depositedAmount: true },
    }),
    prisma.chairopsCashCollection.findFirst({
      where: { branchId },
      orderBy: { collectedAt: "desc" },
      select: { collectedAt: true },
    }),
    prisma.chairopsPosDaily.findFirst({
      where: { branchId },
      orderBy: { bizDate: "desc" },
      select: { bizDate: true },
    }),
  ]);

  const posTotal = posAgg._sum.totalRevenue ?? 0;
  const depositTotal = depositAgg._sum.depositedAmount ?? 0;
  const driftAmount = posTotal - depositTotal;

  // Determine when drift began
  let driftSince: Date | null = null;
  if (driftAmount > 0) {
    const current = await prisma.chairopsDrift.findUnique({ where: { branchId } });
    if (current?.driftSince && current.driftAmount > 0) {
      driftSince = current.driftSince;
    } else {
      driftSince = new Date();
    }
  }

  const lastCollectionAt = lastCollection?.collectedAt ?? null;
  const daysSinceLastCollection = lastCollectionAt ? ageDays(lastCollectionAt) : 999;
  const driftHours = driftSince ? ageHours(driftSince) : 0;

  await prisma.chairopsDrift.upsert({
    where: { branchId },
    update: {
      posTotal,
      depositTotal,
      driftAmount,
      driftSince,
      lastPosDate: lastPos?.bizDate ?? null,
      lastCollectionAt,
      daysSinceLastCollection,
      lastComputedAt: new Date(),
    },
    create: {
      branchId,
      posTotal,
      depositTotal,
      driftAmount,
      driftSince,
      lastPosDate: lastPos?.bizDate ?? null,
      lastCollectionAt,
      daysSinceLastCollection,
    },
  });

  let status: BranchDriftSnapshot["status"] = "ok";
  if (driftAmount < -DRIFT_DEFAULTS.surplusToleranceBaht) status = "surplus";
  else if (
    driftAmount > DRIFT_DEFAULTS.shortageThresholdBaht &&
    driftHours >= DRIFT_DEFAULTS.shortageAgeHoursToAlert
  ) {
    status = "shortage";
  } else if (driftAmount > 0) {
    status = "watch";
  }
  if (daysSinceLastCollection > DRIFT_DEFAULTS.maxDaysSinceCollection) {
    status = "missed";
  }

  return {
    branchId,
    branchName: branch.name,
    posTotal,
    depositTotal,
    driftAmount,
    driftHours,
    lastCollectionAt,
    daysSinceLastCollection,
    status,
  };
}

export async function recomputeAllDrifts(): Promise<BranchDriftSnapshot[]> {
  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const results: BranchDriftSnapshot[] = [];
  for (const b of branches) {
    results.push(await recomputeDriftForBranch(b.id));
  }
  return results;
}

export async function getDashboardRows() {
  const drifts = await prisma.chairopsDrift.findMany({
    include: { branch: true },
  });
  return drifts
    .map((d) => ({
      branchId: d.branchId,
      branchSlug: d.branch.slug,
      branchName: d.branch.name,
      mallGroup: d.branch.mallGroup,
      floor: d.branch.floor,
      posTotal: d.posTotal,
      depositTotal: d.depositTotal,
      driftAmount: d.driftAmount,
      driftSince: d.driftSince,
      driftHours: d.driftSince ? ageHours(d.driftSince) : 0,
      lastCollectionAt: d.lastCollectionAt,
      daysSinceLastCollection: d.daysSinceLastCollection,
      isActive: d.branch.isActive,
    }))
    .sort((a, b) => b.driftAmount - a.driftAmount);
}
