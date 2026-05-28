// ============================================================
// Drift Engine — Wave 0 rewrite (BIGFEATURE_chairops_SPEC §2.3)
// ============================================================
// Two modes, picked by env `CHAIROPS_DRIFT_MODE`:
//
//   - "legacy" (DEFAULT) — original lifetime-sum behavior. Kept verbatim so
//      dual-write/dual-read can compare for 7 days before we flip prod to
//      "window". See [[chairops-drift-window-refactor-2026-05-27]].
//
//   - "window" — new daily-window logic anchored on
//      `ChairopsBranch.lastReconcileClosedAt` (added by W0 migration). When
//      that anchor is null we fall back to `branch.createdAt` (and clamp to
//      a 90-day sensible default if even that is null).
//
// Money math:
//   - posSince = SUM(ChairopsBranchDailyRevenue.cashTotal WHERE bizDate > anchor.date AND orgId AND branchId)
//   - depSince = SUM(ChairopsCashCollection.depositedAmount WHERE collectedAt > anchor AND orgId AND branchId)
//   - drift = posSince - depSince
//
// Alerts (logic same in both modes · only the inputs change):
//   - drift > 0 AND ageHours >= 24 → SHORTAGE CRITICAL
//   - daysSinceLastCollection > 1  → MISSED_COLLECTION WARN
//
// Persistence:
//   - We still upsert into `ChairopsDrift` (one row per branch). The window
//     anchor is stashed in `ChairopsDrift.driftSince` (when drift > 0) so
//     downstream alert + dashboard code is unchanged.
//
// References:
//   [[chairops-no-cumulative-shortage]] · [[chairops-maid-schedule-irregular]]
// ============================================================

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ageHours, ageDays } from "@/lib/chairops/utils/format";

// ----------------------------------------------------------------
// Public defaults (kept identical to v0 so callers don't break)
// ----------------------------------------------------------------
export const DRIFT_DEFAULTS = {
  shortageThresholdBaht: 0, // zero tolerance per CEO
  shortageAgeHoursToAlert: 24,
  surplusToleranceBaht: 100, // surplus < 100฿ = noise, ignore (tip)
  maxDaysSinceCollection: 1, // alert if maid hasn't collected in 1+ day
} as const;

// Fallback window if branch has no `lastReconcileClosedAt` AND no `createdAt`.
const DEFAULT_FALLBACK_DAYS = 90;

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
  /** Which mode produced this snapshot · useful for legacy/window dual-read diff. */
  mode: "legacy" | "window";
  /** Window anchor (null in legacy mode). */
  windowStartAt: Date | null;
}

// ----------------------------------------------------------------
// Mode resolution
// ----------------------------------------------------------------
type DriftMode = "legacy" | "window";

function resolveMode(): DriftMode {
  return process.env.CHAIROPS_DRIFT_MODE === "window" ? "window" : "legacy";
}

// ----------------------------------------------------------------
// orgId helper — every chairops table now requires orgId on writes.
// ----------------------------------------------------------------
export async function getOrgIdForBranch(branchId: string): Promise<string> {
  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: branchId },
    select: { orgId: true },
  });
  return branch.orgId;
}

// Decimal helper · all monetary aggregates come back as Prisma.Decimal | null.
function toNum(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return d.toNumber();
}

// ----------------------------------------------------------------
// LEGACY · lifetime-sum (kept for 7-day dual-read window)
// ----------------------------------------------------------------
async function recomputeDriftForBranch_legacy(
  branchId: string,
): Promise<BranchDriftSnapshot> {
  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: branchId },
  });

  const [posAgg, depositAgg, lastCollection, lastPos] = await Promise.all([
    prisma.chairopsPosDaily.aggregate({
      where: { branchId, orgId: branch.orgId },
      _sum: { grossTotal: true },
    }),
    prisma.chairopsCashCollection.aggregate({
      where: { branchId, orgId: branch.orgId },
      _sum: { depositedAmount: true },
    }),
    prisma.chairopsCashCollection.findFirst({
      where: { branchId, orgId: branch.orgId },
      orderBy: { collectedAt: "desc" },
      select: { collectedAt: true },
    }),
    prisma.chairopsPosDaily.findFirst({
      where: { branchId, orgId: branch.orgId },
      orderBy: { bizDate: "desc" },
      select: { bizDate: true },
    }),
  ]);

  const posTotal = toNum(posAgg._sum?.grossTotal);
  const depositTotal = depositAgg._sum?.depositedAmount ?? 0;
  const driftAmount = posTotal - depositTotal;

  // Determine when drift began (same logic as v0 · uses existing driftSince anchor)
  let driftSince: Date | null = null;
  if (driftAmount > 0) {
    const current = await prisma.chairopsDrift.findFirst({
      where: { branchId, orgId: branch.orgId },
    });
    if (current?.driftSince && current.driftAmount > 0) {
      driftSince = current.driftSince;
    } else {
      driftSince = new Date();
    }
  }

  const lastCollectionAt = lastCollection?.collectedAt ?? null;
  const daysSinceLastCollection = lastCollectionAt ? ageDays(lastCollectionAt) : 999;
  const driftHours = driftSince ? ageHours(driftSince) : 0;

  await persistDrift({
    orgId: branch.orgId,
    branchId,
    posTotal,
    depositTotal,
    driftAmount,
    driftSince,
    lastPosDate: lastPos?.bizDate ?? null,
    lastCollectionAt,
    daysSinceLastCollection,
  });

  return {
    branchId,
    branchName: branch.name,
    posTotal,
    depositTotal,
    driftAmount,
    driftHours,
    lastCollectionAt,
    daysSinceLastCollection,
    status: classifyStatus(driftAmount, driftHours, daysSinceLastCollection),
    mode: "legacy",
    windowStartAt: null,
  };
}

// ----------------------------------------------------------------
// WINDOW · daily-anchored (SPEC §2.3 target behavior)
// ----------------------------------------------------------------
async function recomputeDriftForBranch_window(
  branchId: string,
): Promise<BranchDriftSnapshot> {
  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: branchId },
  });

  // Resolve window anchor · prefer lastReconcileClosedAt → branch.createdAt → fallback
  const anchor: Date = (() => {
    if (branch.lastReconcileClosedAt) return branch.lastReconcileClosedAt;
    if (branch.createdAt) return branch.createdAt;
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - DEFAULT_FALLBACK_DAYS);
    return fallback;
  })();

  // anchor as a date for bizDate comparison (Date column in DB)
  const anchorDate = new Date(anchor);
  anchorDate.setHours(0, 0, 0, 0);

  const [posAgg, depositAgg, lastCollection, lastPos] = await Promise.all([
    // POS since the window opened · ChairopsBranchDailyRevenue is the new
    // per-branch-per-day aggregate (BA-2 / W0 migration step 6).
    prisma.chairopsBranchDailyRevenue.aggregate({
      where: {
        branchId,
        orgId: branch.orgId,
        bizDate: { gt: anchorDate },
      },
      _sum: { cashTotal: true },
    }),
    prisma.chairopsCashCollection.aggregate({
      where: {
        branchId,
        orgId: branch.orgId,
        collectedAt: { gt: anchor },
      },
      _sum: { depositedAmount: true },
    }),
    prisma.chairopsCashCollection.findFirst({
      where: { branchId, orgId: branch.orgId },
      orderBy: { collectedAt: "desc" },
      select: { collectedAt: true },
    }),
    prisma.chairopsBranchDailyRevenue.findFirst({
      where: { branchId, orgId: branch.orgId },
      orderBy: { bizDate: "desc" },
      select: { bizDate: true },
    }),
  ]);

  let posTotal = toNum(posAgg._sum?.cashTotal);
  // Fallback when no daily-revenue rows exist yet (W0 pre-import phase).
  if (posTotal === 0) {
    const legacyPos = await prisma.chairopsPosDaily.aggregate({
      where: {
        branchId,
        orgId: branch.orgId,
        bizDate: { gt: anchorDate },
      },
      _sum: { cashTotal: true },
    });
    posTotal = toNum(legacyPos._sum?.cashTotal);
  }

  const depositTotal = depositAgg._sum?.depositedAmount ?? 0;
  const driftAmount = posTotal - depositTotal;

  // Window mode: drift "since" = window anchor (so age = age of the window
  // boundary, not the moment we noticed). Matches CEO mental model
  // "เงินขาดตั้งแต่ปิดบัญชีรอบที่แล้ว".
  const driftSince: Date | null = driftAmount > 0 ? anchor : null;
  const lastCollectionAt = lastCollection?.collectedAt ?? null;
  const daysSinceLastCollection = lastCollectionAt ? ageDays(lastCollectionAt) : 999;
  const driftHours = driftSince ? ageHours(driftSince) : 0;

  await persistDrift({
    orgId: branch.orgId,
    branchId,
    posTotal,
    depositTotal,
    driftAmount,
    driftSince,
    lastPosDate: lastPos?.bizDate ?? null,
    lastCollectionAt,
    daysSinceLastCollection,
  });

  return {
    branchId,
    branchName: branch.name,
    posTotal,
    depositTotal,
    driftAmount,
    driftHours,
    lastCollectionAt,
    daysSinceLastCollection,
    status: classifyStatus(driftAmount, driftHours, daysSinceLastCollection),
    mode: "window",
    windowStartAt: anchor,
  };
}

// ----------------------------------------------------------------
// Shared classifier + persistence
// ----------------------------------------------------------------
function classifyStatus(
  driftAmount: number,
  driftHours: number,
  daysSinceLastCollection: number,
): BranchDriftSnapshot["status"] {
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
  return status;
}

async function persistDrift(args: {
  orgId: string;
  branchId: string;
  posTotal: number;
  depositTotal: number;
  driftAmount: number;
  driftSince: Date | null;
  lastPosDate: Date | null;
  lastCollectionAt: Date | null;
  daysSinceLastCollection: number;
}) {
  // ChairopsDrift.posTotal/depositTotal/driftAmount are Int in schema today;
  // round to nearest baht (the Decimal widening lives on ChairopsPosDaily,
  // not on ChairopsDrift). When Wave-1 widens these too, this rounds away
  // sub-baht noise · acceptable for an aggregate cache.
  const posTotalInt = Math.round(args.posTotal);
  const depositTotalInt = Math.round(args.depositTotal);
  const driftAmountInt = Math.round(args.driftAmount);

  // Upsert keyed on (orgId, branchId) composite unique (W0 migration step 3).
  // Prisma client doesn't generate compound unique upsert keys reliably
  // across versions · use findFirst + update/create to be safe.
  const existing = await prisma.chairopsDrift.findFirst({
    where: { orgId: args.orgId, branchId: args.branchId },
    select: { id: true },
  });

  if (existing) {
    await prisma.chairopsDrift.update({
      where: { id: existing.id },
      data: {
        posTotal: posTotalInt,
        depositTotal: depositTotalInt,
        driftAmount: driftAmountInt,
        driftSince: args.driftSince,
        lastPosDate: args.lastPosDate,
        lastCollectionAt: args.lastCollectionAt,
        daysSinceLastCollection: args.daysSinceLastCollection,
        lastComputedAt: new Date(),
      },
    });
  } else {
    await prisma.chairopsDrift.create({
      data: {
        orgId: args.orgId,
        branchId: args.branchId,
        posTotal: posTotalInt,
        depositTotal: depositTotalInt,
        driftAmount: driftAmountInt,
        driftSince: args.driftSince,
        lastPosDate: args.lastPosDate,
        lastCollectionAt: args.lastCollectionAt,
        daysSinceLastCollection: args.daysSinceLastCollection,
      },
    });
  }
}

// ----------------------------------------------------------------
// Public API · picks legacy vs window based on env
// ----------------------------------------------------------------
export async function recomputeDriftForBranch(
  branchId: string,
): Promise<BranchDriftSnapshot> {
  return resolveMode() === "window"
    ? recomputeDriftForBranch_window(branchId)
    : recomputeDriftForBranch_legacy(branchId);
}

export async function recomputeAllDrifts(
  orgId?: string,
): Promise<BranchDriftSnapshot[]> {
  // Scope to one org when provided — every caller runs inside an org-scoped
  // session, so an unscoped recompute would silently touch other tenants'
  // branches (cross-org write leak). Pool multi-tenant rule.
  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true, ...(orgId ? { orgId } : {}) },
    select: { id: true },
  });
  const results: BranchDriftSnapshot[] = [];
  for (const b of branches) {
    results.push(await recomputeDriftForBranch(b.id));
  }
  return results;
}

export async function getDashboardRows(orgId?: string) {
  // SECURITY: must scope to the caller's org — ChairopsDrift has no RLS at this
  // layer, so an unscoped findMany leaks every tenant's drift rows into the
  // exec dashboard KPIs/leaderboard. orgId is optional only for back-compat
  // with internal cron callers; UI callers ALWAYS pass it.
  const drifts = await prisma.chairopsDrift.findMany({
    where: orgId ? { orgId } : undefined,
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
