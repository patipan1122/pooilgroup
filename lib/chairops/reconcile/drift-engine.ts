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
//   - posSince = SUM(ChairopsBranchDailyRevenue.cashTotal + coinInsertCount×COIN_BAHT
//                WHERE bizDate > anchor.date AND orgId AND branchId)
//                (CEO 2026-06-25: coin baht is cash the maid also hands in)
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
import { COIN_BAHT } from "@/lib/chairops/reconcile/constants";

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
// Bangkok day-grain date helpers (for "ตั้งต้น ณ วันที่" upper bounds).
// `day` = "YYYY-MM-DD" interpreted as a Bangkok calendar day.
// ----------------------------------------------------------------
function bangkokDayStartUTC(day: string): Date {
  return new Date(`${day}T00:00:00+07:00`);
}
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function dateColValue(day: string): Date {
  // Prisma `@db.Date` columns round-trip at UTC midnight of the calendar date.
  return new Date(`${day}T00:00:00.000Z`);
}

// ----------------------------------------------------------------
// Shared money formula (legacy/lifetime + "as of date X" residual).
// SINGLE SOURCE so the persisted engine drift, the write-off auto-fill, and
// any other caller can never disagree ([[chairops-coin-into-total-and-drift]]
// "money table มี 2 read-path ต้องแก้ให้ครบ").
//
//   posTotal     = Σ ChairopsPosDaily.cashTotal + Σ coinInsertCount × COIN_BAHT
//   depositTotal = Σ CashDeposit.depositedAmount + bankFee
//                + Σ legacy CashCollection.depositedAmount (depositId IS NULL)
//                + netWriteOff
//   netWriteOff  = Σ APPROVED amount(SHORT) − Σ APPROVED amount(OVER)
//   driftAmount  = posTotal − depositTotal   (positive = shortage/ค้างฝาก)
//
// `upToDay` (Bangkok "YYYY-MM-DD") bounds every source to ≤ that day — used by
// the "ตั้งต้น" auto-fill to ask "how much drift is owed UP TO date X?". Pass
// null for the lifetime total the engine persists. Coin baht is preserved
// (CEO 2026-06-25) so a re-baseline never silently drops coin-box cash.
// ----------------------------------------------------------------
export async function computeDriftMoneyAsOf(
  branchId: string,
  orgId: string,
  upToDay: string | null,
): Promise<{ posTotal: number; depositTotal: number; driftAmount: number }> {
  const bizDateFilter = upToDay ? { lte: dateColValue(upToDay) } : undefined;
  // depositedAt / collectedAt are DateTime (UTC) — upper bound is the START of
  // the NEXT Bangkok day, exclusive, so all of day X (Bangkok) is included.
  const dtFilter = upToDay ? { lt: bangkokDayStartUTC(nextDay(upToDay)) } : undefined;
  const effFilter = upToDay ? { lte: dateColValue(upToDay) } : undefined;

  const [posAgg, newDepositAgg, legacyDepositAgg, woShortAgg, woOverAgg] =
    await Promise.all([
      prisma.chairopsPosDaily.aggregate({
        where: { branchId, orgId, ...(bizDateFilter ? { bizDate: bizDateFilter } : {}) },
        // drift = CASH owed to maid · + coin baht (coinInsertCount × COIN_BAHT).
        _sum: { cashTotal: true, coinInsertCount: true },
      }),
      prisma.chairopsCashDeposit.aggregate({
        where: { branchId, orgId, ...(dtFilter ? { depositedAt: dtFilter } : {}) },
        _sum: { depositedAmount: true, bankFee: true },
      }),
      prisma.chairopsCashCollection.aggregate({
        where: {
          branchId,
          orgId,
          depositId: null,
          depositedAmount: { gt: 0 },
          ...(dtFilter ? { collectedAt: dtFilter } : {}),
        },
        _sum: { depositedAmount: true },
      }),
      // Approved write-offs · netted by direction. SHORT adds to deposit side
      // (reduces a positive/ค้างฝาก drift); OVER subtracts (reduces a negative/
      // ฝากเกิน drift toward zero). effectiveDate bounds the "ตั้งต้น" residual.
      prisma.chairopsWriteOff.aggregate({
        where: {
          branchId,
          orgId,
          status: "APPROVED",
          direction: "SHORT",
          ...(effFilter ? { effectiveDate: effFilter } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.chairopsWriteOff.aggregate({
        where: {
          branchId,
          orgId,
          status: "APPROVED",
          direction: "OVER",
          ...(effFilter ? { effectiveDate: effFilter } : {}),
        },
        _sum: { amount: true },
      }),
    ]);

  const posTotal =
    toNum(posAgg._sum?.cashTotal) +
    (posAgg._sum?.coinInsertCount ?? 0) * COIN_BAHT;
  const netWriteOff =
    (woShortAgg._sum?.amount ?? 0) - (woOverAgg._sum?.amount ?? 0);
  const depositTotal =
    (newDepositAgg._sum?.depositedAmount ?? 0) +
    (newDepositAgg._sum?.bankFee ?? 0) +
    (legacyDepositAgg._sum?.depositedAmount ?? 0) +
    netWriteOff;
  const driftAmount = posTotal - depositTotal;
  return { posTotal, depositTotal, driftAmount };
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

  // Money formula lives in computeDriftMoneyAsOf (single source · shared with
  // the write-off auto-fill · coin baht preserved). `null` = lifetime total.
  // Deposit source switched 2026-05-30 to ChairopsCashDeposit (+ bankFee) with
  // legacy CashCollection rows folded in; approved write-offs netted by
  // direction (SHORT−OVER).
  const [money, lastCollection, lastPos] = await Promise.all([
    computeDriftMoneyAsOf(branchId, branch.orgId, null),
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

  const { posTotal, depositTotal, driftAmount } = money;

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

  const [posAgg, newDepositAgg, legacyDepositAgg, woShortAgg, woOverAgg, lastCollection, lastPos] =
    await Promise.all([
      // POS since the window opened · ChairopsBranchDailyRevenue is the new
      // per-branch-per-day aggregate (BA-2 / W0 migration step 6).
      // CEO 2026-06-25: coin baht (coinInsertCount × COIN_BAHT) added below.
      prisma.chairopsBranchDailyRevenue.aggregate({
        where: {
          branchId,
          orgId: branch.orgId,
          bizDate: { gt: anchorDate },
        },
        _sum: { cashTotal: true, coinInsertCount: true },
      }),
      // 2026-05-30 split: deposit total = sum from new cash_deposits + any
      // legacy CashCollection rows where the maid recorded a deposit on the
      // row itself (depositId still null, depositedAmount > 0).
      // 2026-05-31 audit P0 #1: include bankFee in deposit-side total.
      prisma.chairopsCashDeposit.aggregate({
        where: {
          branchId,
          orgId: branch.orgId,
          depositedAt: { gt: anchor },
        },
        _sum: { depositedAmount: true, bankFee: true },
      }),
      prisma.chairopsCashCollection.aggregate({
        where: {
          branchId,
          orgId: branch.orgId,
          collectedAt: { gt: anchor },
          depositId: null,
          depositedAmount: { gt: 0 },
        },
        _sum: { depositedAmount: true },
      }),
      // Sprint-1 fix: approved write-offs reduce the effective shortage · netted
      // by direction (SHORT−OVER, CEO 2026-06-25). Window mode: only write-offs
      // approved within this window count (pre-anchor ones are "closed").
      prisma.chairopsWriteOff.aggregate({
        where: { branchId, orgId: branch.orgId, status: "APPROVED", direction: "SHORT", approverAt: { gt: anchor } },
        _sum: { amount: true },
      }),
      prisma.chairopsWriteOff.aggregate({
        where: { branchId, orgId: branch.orgId, status: "APPROVED", direction: "OVER", approverAt: { gt: anchor } },
        _sum: { amount: true },
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

  let posTotal =
    toNum(posAgg._sum?.cashTotal) +
    (posAgg._sum?.coinInsertCount ?? 0) * COIN_BAHT;
  // Fallback when no daily-revenue rows exist yet (W0 pre-import phase).
  if (posTotal === 0) {
    const legacyPos = await prisma.chairopsPosDaily.aggregate({
      where: {
        branchId,
        orgId: branch.orgId,
        bizDate: { gt: anchorDate },
      },
      _sum: { cashTotal: true, coinInsertCount: true },
    });
    posTotal =
      toNum(legacyPos._sum?.cashTotal) +
      (legacyPos._sum?.coinInsertCount ?? 0) * COIN_BAHT;
  }

  const netWriteOff =
    (woShortAgg._sum?.amount ?? 0) - (woOverAgg._sum?.amount ?? 0);
  const depositTotal =
    (newDepositAgg._sum?.depositedAmount ?? 0) +
    (newDepositAgg._sum?.bankFee ?? 0) +
    (legacyDepositAgg._sum?.depositedAmount ?? 0) +
    netWriteOff;
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
  // "shortage" beats "missed" — a branch with cash owed AND no recent
  // collection is a SHORTAGE first. Overwriting it with "missed" silenced
  // the SHORTAGE alert for almost every real delinquent branch.
  if (daysSinceLastCollection > DRIFT_DEFAULTS.maxDaysSinceCollection && status !== "shortage") {
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
  // FIN-01 (audit 2026-06-15): per-branch mode. Once a branch's period is closed
  // (lastReconcileClosedAt set via the "ปิดงวด" action), it measures drift
  // per-period (window). Until then it stays legacy/lifetime — so nothing changes
  // for anyone until the super_admin clicks "ปิดงวด" (atomic activation, no env
  // flip, no surprise jump). `CHAIROPS_DRIFT_MODE=window` still works as a global
  // override for backward-compat.
  const branch = await prisma.chairopsBranch.findUnique({
    where: { id: branchId },
    select: { lastReconcileClosedAt: true },
  });
  const useWindow = branch?.lastReconcileClosedAt != null || resolveMode() === "window";
  return useWindow
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

  // Parallelize with BOUNDED concurrency. Each branch recompute fans out to
  // ~6 aggregate queries; a fully-unbounded Promise.all over 30+ branches would
  // open 200+ simultaneous queries and exhaust the Supabase transaction pooler
  // (:6543). Processing in chunks of CONCURRENCY keeps the fan-out safe while
  // collapsing the old sequential loop (was ~30 round-trips deep) to ~6.
  // Each branch writes only its own (orgId, branchId) ChairopsDrift row, so
  // there is no write-write race between concurrent tasks within one call.
  const CONCURRENCY = 5;
  const results: BranchDriftSnapshot[] = [];
  for (let i = 0; i < branches.length; i += CONCURRENCY) {
    const chunk = branches.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((b) => recomputeDriftForBranch(b.id)),
    );
    results.push(...chunkResults);
  }
  return results;
}

/**
 * READ the cached drift snapshot for a branch WITHOUT recomputing or writing.
 *
 * For hot read-only render paths (e.g. the maid LIFF home) a fresh recompute is
 * unnecessary: every economic event that can move drift — cash collection &
 * deposit (collect/actions), write-off approval, POS import (pos-ingest), and
 * the gmail-import cron — ALREADY calls recomputeDriftForBranch/recomputeAllDrifts
 * and persists the cache. Recomputing on every page open was redundant work AND
 * a write-on-GET (a persistDrift upsert per render, which also races concurrent
 * opens of the same branch).
 *
 * Falls back to a one-time recomputeDriftForBranch when no cached row exists yet
 * (brand-new branch never computed), so callers always get a snapshot.
 */
export async function readDriftSnapshot(
  branchId: string,
  orgId?: string,
): Promise<BranchDriftSnapshot> {
  const cached = await prisma.chairopsDrift.findFirst({
    where: { branchId, ...(orgId ? { orgId } : {}) },
    include: { branch: { select: { name: true } } },
  });
  if (!cached) {
    // Cold cache (never computed) → compute once so the page isn't empty.
    return recomputeDriftForBranch(branchId);
  }
  const driftHours = cached.driftSince ? ageHours(cached.driftSince) : 0;
  const daysSinceLastCollection = cached.lastCollectionAt
    ? ageDays(cached.lastCollectionAt)
    : 999;
  return {
    branchId,
    branchName: cached.branch.name,
    posTotal: cached.posTotal,
    depositTotal: cached.depositTotal,
    driftAmount: cached.driftAmount,
    driftHours,
    lastCollectionAt: cached.lastCollectionAt,
    daysSinceLastCollection,
    status: classifyStatus(
      cached.driftAmount,
      driftHours,
      daysSinceLastCollection,
    ),
    mode: resolveMode(),
    windowStartAt: null,
  };
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
