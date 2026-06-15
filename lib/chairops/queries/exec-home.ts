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
import { getCumulativeShortage } from "@/lib/chairops/queries/_cumulative-shortage";
import { getDepositsInRange } from "@/lib/chairops/queries/_deposits";
import {
  ChairopsAlertLevel,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";

// Maid cash cut-off (mockup: "ตัด cut-off 17:00").
export const MAID_CUTOFF_HOUR = 17;

// ----------------------------------------------------------------
// Bangkok day boundaries (Asia/Bangkok = UTC+7, no DST).
//
// CEO reads dashboard every morning before 7am BKK. Naive `new Date()
// .setHours(0,0,0,0)` on a UTC server (Vercel default) returns UTC midnight,
// which between BKK 00:00–07:00 sits in YESTERDAY's BKK calendar day → the
// "วันนี้" tiles show yesterday-BKK data. Fix: compute the BKK calendar date
// via Intl, then materialize two flavors:
//   • `bangkokStartOfToday()`  → UTC INSTANT when BKK wall clock hit 00:00
//     (used for timestamp columns like collectedAt / createdAt / uploadedAt).
//   • `bangkokDateOfToday()`   → UTC midnight of the BKK calendar date
//     (used for `@db.Date` columns like bizDate, where Prisma compares the
//     UTC date portion of the parameter).
// ----------------------------------------------------------------
function bangkokYmd(d: Date): string {
  // Returns "YYYY-MM-DD" in Asia/Bangkok regardless of server TZ.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // en-CA gives ISO YYYY-MM-DD
}

/** Current hour (0–23) in Asia/Bangkok regardless of server TZ. */
function bangkokHour(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    hour12: false,
  });
  return Number(fmt.format(d)); // "00".."23"
}

/** UTC instant of "today 00:00 Asia/Bangkok". Use for timestamp columns. */
function bangkokStartOfToday(): Date {
  const ymd = bangkokYmd(new Date());
  return new Date(`${ymd}T00:00:00+07:00`);
}

/** UTC midnight of today's BKK calendar date. Use for `@db.Date` columns. */
function bangkokDateOfToday(): Date {
  const ymd = bangkokYmd(new Date());
  return new Date(`${ymd}T00:00:00Z`);
}

/** UTC midnight of (today_BKK − n days). Use for `@db.Date` columns. */
function bangkokDateOfDaysAgo(days: number): Date {
  const base = bangkokDateOfToday();
  return new Date(base.getTime() - days * 86_400_000);
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
  /** BF1 · Sum of MaidDailyPay for the current BKK month (admin-only tile). */
  maidWageMonth: number;
  /** Pre-sorted by shortage size desc (largest drift first). */
  branches: Awaited<ReturnType<typeof getDashboardRows>>;
  computedAt: Date;
}

export const getExecHomeKpis = cache(async function getExecHomeKpis(
  orgId: string,
): Promise<ExecHomeKpis> {
  // Timestamps → UTC instant of BKK 00:00 today.
  const tsToday = bangkokStartOfToday();
  // `@db.Date` columns → UTC midnight of BKK calendar date.
  const dToday = bangkokDateOfToday();
  const d7Ago = bangkokDateOfDaysAgo(7);
  const d30Ago = bangkokDateOfDaysAgo(30);
  const d60Ago = bangkokDateOfDaysAgo(60);

  const [
    rows,
    cumShortage,
    posTodayAgg,
    posTrailing7Agg,
    depositsTodayByBranch,
    criticalAlertCount,
    pos30Agg,
    posPrior30Agg,
  ] = await Promise.all([
    getDashboardRows(orgId),
    // Canonical "ค้างฝากรวม" — positive-only sum across active branches.
    // Single source of truth shared with reconcile-shell hero + sidebar org row.
    // See lib/chairops/queries/_cumulative-shortage.ts (CEO ruling 2026-06-02).
    getCumulativeShortage(orgId),
    // Today's POS gross (cash + online) for the org.
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: dToday } },
      _sum: { grossTotal: true },
    }),
    // Trailing 7 days (excluding today) → average daily.
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: d7Ago, lt: dToday } },
      _sum: { grossTotal: true },
    }),
    // Per-branch deposit totals today — drift-engine formula (CashDeposit +
    // bankFee + legacy CashCollection.depositedAmount where depositId IS NULL).
    // Was reading the now-dead `CashCollection.depositedAmount` column (always
    // 0 after Wave-2) which made the "ฝากแม่บ้านวันนี้" KPI + "X/30 สาขาส่ง
    // แล้ว" count drop to 0 once the maid LIFF stopped writing it. See
    // `_deposits.ts` for the canonical helper (CEO 2026-06-02 P0).
    getDepositsInRange({ orgId, since: tsToday }),
    prisma.chairopsAlert.count({
      where: {
        orgId,
        status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        level: ChairopsAlertLevel.CRITICAL,
      },
    }),
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: d30Ago } },
      _sum: { grossTotal: true },
    }),
    prisma.chairopsPosDaily.aggregate({
      where: { orgId, bizDate: { gte: d60Ago, lt: d30Ago } },
      _sum: { grossTotal: true },
    }),
  ]);

  const activeRows = rows.filter((r) => r.isActive);
  // "Critical" subset = positive drift AND ≥24h old (mockup gating). Aggregate
  // KPI tile uses the canonical helper (any positive drift, no age gate) so
  // it matches reconcile-shell hero + sidebar org row exactly.
  const shortageBranchCount = activeRows.filter(
    (r) => r.driftAmount > 0 && r.driftHours >= 24,
  ).length;
  const cumulativeDriftTotal = cumShortage.total;
  const shortageBranchDays = activeRows.reduce(
    (sum, r) => sum + (r.driftAmount > 0 ? Math.floor(r.driftHours / 24) : 0),
    0,
  );

  // Missed maids = active branches that have NOT deposited today,
  //                AND have a working maid (excluding leave + no-slot).
  // BF1 (2026-06-02) · subtract leave-today + no-maid branches so the KPI
  // counts only "real" missed days, matching the missed-maids-card variant
  // logic. CEO's old morning false-alarm class is dead at the source.
  const depositedSet = new Set(depositsTodayByBranch.keys());
  const [maidsAssigned, leavesToday] = await Promise.all([
    prisma.chairopsUser.findMany({
      where: {
        orgId,
        role: "MAID",
        isActive: true,
        primaryBranchId: { in: activeRows.map((r) => r.branchId) },
      },
      select: { id: true, primaryBranchId: true },
    }),
    prisma.chairopsMaidDayOff.findMany({
      where: { orgId, date: dToday },
      select: { maidId: true },
    }),
  ]);
  const branchHasMaidSet = new Set(
    maidsAssigned
      .map((m) => m.primaryBranchId)
      .filter((id): id is string => !!id),
  );
  const leaveMaidIds = new Set(leavesToday.map((l) => l.maidId));
  const leaveBranchIdSet = new Set(
    maidsAssigned
      .filter((m) => m.primaryBranchId && leaveMaidIds.has(m.id))
      .map((m) => m.primaryBranchId as string),
  );
  // CO-WF-01 fix: before the BKK cut-off hour, maids haven't "missed" anything —
  // they still have until 17:00 to deposit. Counting them as missed from morning
  // showed a false red alarm every day. Gate to 0 before cut-off; only after the
  // cut-off is a non-deposit an actual miss.
  const pastCutoff = bangkokHour(new Date()) >= MAID_CUTOFF_HOUR;
  const missedMaidCount = pastCutoff
    ? activeRows.filter(
        (r) =>
          !depositedSet.has(r.branchId) &&
          branchHasMaidSet.has(r.branchId) &&
          !leaveBranchIdSet.has(r.branchId),
      ).length
    : 0;
  let todayDepositTotal = 0;
  for (const amt of depositsTodayByBranch.values()) todayDepositTotal += amt;

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

  // BF1 · MTD maid wage (admin-only · canViewCost = rank >= CEO at caller).
  // Compute month-start in BKK calendar to match the rest of the KPIs.
  const ymd = bangkokYmd(new Date());
  const monthStart = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  const maidWageAgg = await prisma.chairopsMaidDailyPay.aggregate({
    where: { orgId, date: { gte: monthStart } },
    _sum: { amount: true },
  });
  const maidWageMonth = maidWageAgg._sum?.amount ?? 0;

  return {
    todayPosRevenue,
    posDeltaPct,
    todayDepositTotal,
    depositedBranchCount: depositedSet.size,
    cumulativeDriftTotal,
    shortageBranchDays,
    shortageBranchCount,
    missedMaidCount,
    criticalOpenAlertCount: criticalAlertCount,
    profit30d,
    profit30dDeltaPct,
    activeBranchCount: activeRows.length,
    maidWageMonth,
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
  // bizDate is `@db.Date` → use UTC-midnight of BKK calendar date.
  // collectedAt is a timestamp → use UTC instant of BKK 00:00.
  const dToday = bangkokDateOfToday();
  const tsToday = bangkokStartOfToday();
  const d6Ago = bangkokDateOfDaysAgo(6); // 7 buckets incl. today

  const [maids, posTodayRows, depositTodayByBranch, posSeriesRows] =
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
        where: { orgId, branchId: { in: branchIds }, bizDate: { gte: dToday } },
        _sum: { grossTotal: true },
      }),
      // Canonical drift-engine deposit formula (CashDeposit + bankFee + legacy
      // CashCollection.depositedAmount where depositId IS NULL). Previously
      // groupBy on `CashCollection.depositedAmount` returned 0 for every
      // branch after Wave-2 because the maid LIFF stopped writing that
      // column — so the dashboard table's "ฝาก" cell read ฿0 next to a real
      // drift. See `_deposits.ts` (CEO 2026-06-02 P0).
      getDepositsInRange({ orgId, branchIds, since: tsToday }),
      prisma.chairopsPosDaily.groupBy({
        by: ["branchId", "bizDate"],
        where: {
          orgId,
          branchId: { in: branchIds },
          bizDate: { gte: d6Ago },
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

  // Build 7-day buckets (oldest → newest) keyed by BKK calendar date string.
  // `bangkokDateOfDaysAgo(i)` is UTC midnight of that BKK calendar date, so
  // `.toISOString().slice(0,10)` is the BKK YMD — matching how Prisma surfaces
  // `bizDate` (`@db.Date`) values below.
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    dayKeys.push(bangkokDateOfDaysAgo(i).toISOString().slice(0, 10));
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
  /**
   * BF1 variant tag · drives row tone + CTA in missed-maids-card:
   *  - "missed_actual" — assigned active maid + working today + no deposit
   *  - "on_leave"      — maid on recorded leave today
   *  - "no_slot"       — branch has no maid assigned
   */
  variant: "missed_actual" | "on_leave" | "no_slot";
  maidName: string | null;
  maidPhone: string | null;
  maidLineUserId: string | null;
  dayOffReason: string | null;
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
  // collectedAt is a timestamp; bizDate is `@db.Date` → two flavors needed.
  const tsToday = bangkokStartOfToday();
  const dToday = bangkokDateOfToday();

  // "Deposited today?" via canonical drift-engine formula.
  const depositsTodayByBranch = await getDepositsInRange({
    orgId,
    since: tsToday,
  });
  const depositedSet = new Set(depositsTodayByBranch.keys());

  // Pre-fetch maid + leave-today data ONCE so we can classify variants.
  const branchIds = active.map((r) => r.branchId);
  const [maids, leavesToday, posTodayRows] = await Promise.all([
    prisma.chairopsUser.findMany({
      where: {
        orgId,
        role: "MAID",
        isActive: true,
        primaryBranchId: { in: branchIds },
      },
      select: {
        id: true,
        displayName: true,
        phone: true,
        lineUserId: true,
        primaryBranchId: true,
      },
    }),
    prisma.chairopsMaidDayOff.findMany({
      where: { orgId, date: dToday },
      select: { maidId: true, reason: true },
    }),
    prisma.chairopsPosDaily.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { in: branchIds }, bizDate: { gte: dToday } },
      _sum: { grossTotal: true },
    }),
  ]);
  const maidByBranch = new Map(
    maids
      .filter((m) => m.primaryBranchId)
      .map((m) => [m.primaryBranchId as string, m]),
  );
  const leaveReasonByMaid = new Map(leavesToday.map((l) => [l.maidId, l.reason]));
  const posTodayByBranch = new Map(
    posTodayRows.map((r) => [r.branchId, decToNum(r._sum?.grossTotal)]),
  );

  // Branches that have NOT deposited today are "candidates" — classify each
  // into missed_actual / on_leave / no_slot.
  const candidates = active
    .filter((r) => !depositedSet.has(r.branchId))
    .sort((a, b) => b.driftAmount - a.driftAmount)
    .slice(0, take);
  if (candidates.length === 0) return [];

  return candidates.map((r) => {
    const maid = maidByBranch.get(r.branchId);
    const onLeave = maid ? leaveReasonByMaid.has(maid.id) : false;
    const variant: MissedMaidRow["variant"] = !maid
      ? "no_slot"
      : onLeave
        ? "on_leave"
        : "missed_actual";
    return {
      branchId: r.branchId,
      branchName: r.branchName,
      variant,
      maidName: maid?.displayName ?? null,
      maidPhone: maid?.phone ?? null,
      maidLineUserId: maid?.lineUserId ?? null,
      dayOffReason: maid && onLeave ? (leaveReasonByMaid.get(maid.id) ?? null) : null,
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
  // uploadedAt + createdAt are timestamps → UTC instant of BKK 00:00.
  const tsToday = bangkokStartOfToday();
  const [lastImport, importsToday, eventsToday] = await Promise.all([
    prisma.chairopsPosImport.findFirst({
      where: { orgId, committed: true },
      orderBy: { uploadedAt: "desc" },
      select: { uploadedAt: true },
    }),
    prisma.chairopsPosImport.count({
      where: { orgId, uploadedAt: { gte: tsToday } },
    }),
    prisma.chairopsAuditLog.count({
      where: { orgId, createdAt: { gte: tsToday } },
    }),
  ]);
  return {
    lastPosImportAt: lastImport?.uploadedAt ?? null,
    posImportsToday: importsToday,
    eventsToday,
  };
});
