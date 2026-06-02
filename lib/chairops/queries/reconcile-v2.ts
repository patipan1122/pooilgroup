// ============================================================
// Reconcile v2 queries — Ledger · Timeline · Periods (mockup parity)
// ============================================================
// Server-only data layer for the redesigned /chairops/reconcile screen.
// Mirrors the CEO mockup `reconcile-v2.jsx` data shapes (LedgerDay · series ·
// period windows) but is sourced from REAL Prisma tables instead of the
// generated mock:
//
//   POS daily   ← ChairopsBranchDailyRevenue (per-branch-per-day aggregate;
//                  falls back to ChairopsPosDaily.cashTotal when the new table
//                  has no rows yet — same fallback the drift-engine uses).
//   Collections ← ChairopsCashCollection (each maid round = one deposit event).
//
// Field mapping (mockup → real schema):
//   online      = onlineTotal
//   cash        = cashTotal            (StarThing "จ่ายเงินสด")
//   coin        = otherTotal           (coin box value in baht)
//   cashTotal   = cashTotal + otherTotal
//   totalRev    = grossTotal
//   deposit     = ChairopsCashCollection.depositedAmount (bucketed to bizDate)
//
// Drift convention here matches the MOCKUP (diff = deposit − expectedCash, so
// NEGATIVE = shortage), which is the inverse of the drift-engine's positive=
// shortage. We do NOT touch the drift-engine or its formula
// ([[chairops-no-cumulative-shortage]]) — this module is DISPLAY ONLY.
//
// All reads filter by orgId (Pool multi-tenant · no hardcoded org).
// References: [[chairops-starthing-xlsx-schema-2026-05-27]] ·
//   [[chairops-maid-schedule-irregular]] · [[react-cache-on-getsession-pattern]]
// ============================================================

import { prisma } from "@/lib/prisma";
import { resolveMall } from "@/lib/chairops/utils/mall-groups";

// ----------------------------------------------------------------
// Public types — shaped to drive the UI directly
// ----------------------------------------------------------------
export interface LedgerDay {
  date: string; // "YYYY-MM-DD"
  online: number;
  cash: number;
  coin: number;
  cashTotal: number; // cash + coin
  totalRev: number; // online + cashTotal
  deposit: number | null; // null = no collection that day
  slip: string | null; // slip / evidence ref
  collected: boolean;
  diff: number; // deposit − expectedCash (collected days only; else 0)
  /** Σ diff up to this row (only closed periods · matches engine convention). */
  closedDrift: number;
  /**
   * Display drift = closedDrift − pending. Negative when there's cash that
   * POS recorded but the maid hasn't deposited yet. Equals engine
   * `−driftAmount` once recompute runs, so the hero/sidebar/footer all agree.
   * CEO 2026-06-02: "ทำไม sidebar -22,761 แต่ ledger 0 — ตัวเลขโกหก"
   * was caused by ignoring `pending` in this column.
   */
  cumDrift: number;
  pending: number; // cash awaiting collection (open balance)
}

export interface LedgerTotals {
  online: number;
  cash: number;
  coin: number;
  cashTotal: number;
  totalRev: number;
  deposit: number;
  diff: number;
  /** Σ pending leftover at the end of the visible window. */
  pending: number;
  /** Engine-side drift at end of window = -(cumDrift at last row). */
  driftEndingEngine: number;
  days: number;
  daysCollected: number;
}

export interface ReconcileFreshness {
  lastPosUploadAt: string | null;
  posCoverThrough: string | null;
  posCoverDaysAgo: number | null;
  lastCollectionLabel: string | null;
  staleBranchCount: number;
  staleBranchNames: string[];
}

export interface ReconcileOverview {
  cumulativeDrift: number;
  monthlyTrend: number; // slope×30 over last 14 days (negative = worsening)
  intent: "crit" | "warn" | "ok";
  spark: number[]; // last 30 cumDrift values for the hero sparkline
  freshness: ReconcileFreshness;
}

export interface TimelinePoint {
  date: string;
  cumPos: number;
  cumDep: number;
  collected: boolean;
}

export interface PeriodWindow {
  from: string;
  to: string;
  days: number;
  posSum: number;
  cashSum: number; // expected cash maid should hand in
  deposit: number | null;
  slip: string | null;
  diff: number | null; // null when window still open
  cumBefore: number;
  cumAfter: number;
  open: boolean;
  intent: "crit" | "warn" | "ok";
}

export interface ReconcileSidebarRow {
  branchId: string;
  name: string;
  mallLabel: string;
  status: "ok" | "warn" | "critical" | "missed";
  cumDrift: number;
  daysSinceCollect: number;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
const DAY_MS = 86_400_000;

function isoDay(d: Date): string {
  // Use local-ish slice; bizDate is a DATE column so its UTC midnight is fine.
  return d.toISOString().slice(0, 10);
}

function toNum(d: { toNumber: () => number } | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return d.toNumber();
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

function nextDate(d: string): string {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function startOfDayMinus(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

// Diff color rule from mockup: collected day → crit if <−100, ok if >100, else muted.
function diffIntent(diff: number, collected: boolean): "crit" | "ok" | "muted" | "warn" {
  if (!collected) return "muted";
  if (diff < -100) return "crit";
  if (diff > 100) return "ok";
  return "muted";
}

// ----------------------------------------------------------------
// Core: build a daily ledger for one branch OR the whole org.
// ----------------------------------------------------------------
async function buildLedger(args: {
  orgId: string;
  branchId?: string;
  days: number;
}): Promise<LedgerDay[]> {
  const { orgId, branchId, days } = args;
  const since = startOfDayMinus(days);

  const branchFilter = branchId ? { branchId } : {};

  // POS daily rows (new aggregate table)
  const revenueRows = await prisma.chairopsBranchDailyRevenue.findMany({
    where: { orgId, ...branchFilter, bizDate: { gte: since } },
    select: {
      bizDate: true,
      onlineTotal: true,
      cashTotal: true,
      otherTotal: true,
      grossTotal: true,
    },
    orderBy: { bizDate: "asc" },
  });

  // Fallback to legacy per-chair POS rows when the aggregate table is empty
  // (W0 pre-import phase) — same strategy as drift-engine window mode.
  let posByDay = new Map<
    string,
    { online: number; cash: number; coin: number; total: number }
  >();
  if (revenueRows.length > 0) {
    for (const r of revenueRows) {
      const key = isoDay(r.bizDate);
      const prev = posByDay.get(key) ?? { online: 0, cash: 0, coin: 0, total: 0 };
      prev.online += toNum(r.onlineTotal);
      prev.cash += toNum(r.cashTotal);
      prev.coin += toNum(r.otherTotal);
      prev.total += toNum(r.grossTotal);
      posByDay.set(key, prev);
    }
  } else {
    const legacy = await prisma.chairopsPosDaily.findMany({
      where: { orgId, ...branchFilter, bizDate: { gte: since } },
      select: {
        bizDate: true,
        onlineTotal: true,
        cashTotal: true,
        grossTotal: true,
      },
      orderBy: { bizDate: "asc" },
    });
    posByDay = new Map();
    for (const r of legacy) {
      const key = isoDay(r.bizDate);
      const prev = posByDay.get(key) ?? { online: 0, cash: 0, coin: 0, total: 0 };
      prev.online += toNum(r.onlineTotal);
      prev.cash += toNum(r.cashTotal);
      // legacy table has no separate coin-baht column → coins fold into total
      prev.total += toNum(r.grossTotal);
      posByDay.set(key, prev);
    }
  }

  // Collection events bucketed to their collectedAt day.
  const collections = await prisma.chairopsCashCollection.findMany({
    where: { orgId, ...branchFilter, collectedAt: { gte: since } },
    select: {
      collectedAt: true,
      depositedAmount: true,
      slipPhotoUrl: true,
      evidencePhotoUrl: true,
    },
    orderBy: { collectedAt: "asc" },
  });
  const depByDay = new Map<string, { deposit: number; slip: string | null }>();
  for (const c of collections) {
    const key = isoDay(c.collectedAt);
    const prev = depByDay.get(key) ?? { deposit: 0, slip: null };
    prev.deposit += c.depositedAmount;
    prev.slip = prev.slip ?? c.slipPhotoUrl ?? c.evidencePhotoUrl ?? "slip";
    depByDay.set(key, prev);
  }

  // Union of all days present in either source, sorted ascending.
  const allDays = new Set<string>([...posByDay.keys(), ...depByDay.keys()]);
  const sortedDays = [...allDays].sort();

  let closedDrift = 0;
  let pending = 0;
  const ledger: LedgerDay[] = [];
  for (const date of sortedDays) {
    const pos = posByDay.get(date) ?? { online: 0, cash: 0, coin: 0, total: 0 };
    const cashTotal = pos.cash + pos.coin;
    const totalRev = pos.total || pos.online + cashTotal;
    pending += cashTotal;

    const dep = depByDay.get(date);
    const collected = !!dep;
    let diff = 0;
    let deposit: number | null = null;
    let slip: string | null = null;
    if (dep) {
      deposit = dep.deposit;
      slip = dep.slip;
      // diff = what maid handed in − cash that accumulated since last collect
      diff = deposit - pending;
      closedDrift += diff;
      pending = 0;
    }

    ledger.push({
      date,
      online: pos.online,
      cash: pos.cash,
      coin: pos.coin,
      cashTotal,
      totalRev,
      deposit,
      slip,
      collected,
      diff: collected ? diff : 0,
      closedDrift,
      // CEO 2026-06-02: cumDrift must reflect OPEN pending too · otherwise a
      // branch that never collects shows 0 cumDrift forever while the side
      // panel/engine show −22,761. Negative = owed by branch (shortage).
      cumDrift: closedDrift - pending,
      pending,
    });
  }

  return ledger;
}

// ----------------------------------------------------------------
// Totals row helper · for the "ยอดรวม" footer the CEO asked for
// 2026-06-02. Sums over WHATEVER ledger slice the caller passes in (so
// date-range filters compose naturally).
// ----------------------------------------------------------------
export function ledgerTotals(rows: LedgerDay[]): LedgerTotals {
  const t: LedgerTotals = {
    online: 0,
    cash: 0,
    coin: 0,
    cashTotal: 0,
    totalRev: 0,
    deposit: 0,
    diff: 0,
    pending: 0,
    driftEndingEngine: 0,
    days: rows.length,
    daysCollected: 0,
  };
  for (const r of rows) {
    t.online += r.online;
    t.cash += r.cash;
    t.coin += r.coin;
    t.cashTotal += r.cashTotal;
    t.totalRev += r.totalRev;
    t.deposit += r.deposit ?? 0;
    t.diff += r.diff;
    if (r.collected) t.daysCollected += 1;
  }
  // Pending is taken from the row whose date is latest in the visible slice
  // (chronologically) — the slice may be displayed newest-first, so pick by
  // date string MAX.
  if (rows.length) {
    const last = rows.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    t.pending = last.pending;
    t.driftEndingEngine = -last.cumDrift;
  }
  return t;
}

// ----------------------------------------------------------------
// 1) OVERVIEW — hero cumulative drift + trend + freshness + sparkline
// ----------------------------------------------------------------
export async function getReconcileOverview(args: {
  orgId: string;
  branchId?: string;
}): Promise<ReconcileOverview> {
  const { orgId, branchId } = args;
  // CEO 2026-06-02: lifetime-window (365d) so the hero cumulativeDrift matches
  // the engine-computed driftAmount that the sidebar displays. A 60-day window
  // dropped the open pending from anything older than 60 days, drifting away
  // from the sidebar number.
  const ledger = await buildLedger({ orgId, branchId, days: 365 });

  const last = ledger[ledger.length - 1];
  const cum = last?.cumDrift ?? 0;

  // Linear regression slope over the last 14 days of cumDrift (mockup logic).
  const recent = ledger.slice(-14);
  let monthlyTrend = 0;
  if (recent.length >= 2) {
    const n = recent.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = recent.reduce((s, d) => s + d.cumDrift, 0);
    const sumXY = recent.reduce((s, d, i) => s + i * d.cumDrift, 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    monthlyTrend = Math.round(slope * 30);
  }
  const fraud = monthlyTrend < -300;
  const safe = Math.abs(monthlyTrend) < 200;
  const intent: "crit" | "warn" | "ok" = fraud ? "crit" : safe ? "ok" : "warn";

  const spark = ledger.slice(-30).map((d) => d.cumDrift);

  // Freshness — last POS upload, coverage, stale branches (≥5 days no collect).
  const [
    lastImport,
    lastRevenue,
    lastLegacyPos,
    lastCollectionAll,
    branches,
    drifts,
  ] = await Promise.all([
    prisma.chairopsPosImport.findFirst({
      where: { orgId },
      orderBy: { uploadedAt: "desc" },
      select: { uploadedAt: true },
    }),
    prisma.chairopsBranchDailyRevenue.findFirst({
      where: { orgId, ...(branchId ? { branchId } : {}) },
      orderBy: { bizDate: "desc" },
      select: { bizDate: true },
    }),
    // CEO 2026-06-02 P0: branches whose POS only ever landed in the legacy
    // chairops_pos_daily (e.g. central โคราช) need a fallback so freshness
    // doesn't claim "POS ครบถึงวัน —" while ledger clearly has data.
    prisma.chairopsPosDaily.findFirst({
      where: { orgId, ...(branchId ? { branchId } : {}) },
      orderBy: { bizDate: "desc" },
      select: { bizDate: true },
    }),
    prisma.chairopsCashCollection.findFirst({
      where: { orgId, ...(branchId ? { branchId } : {}) },
      orderBy: { collectedAt: "desc" },
      include: {
        maid: { select: { displayName: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.chairopsDrift.findMany({
      where: { orgId },
      select: { branchId: true, lastCollectionAt: true },
    }),
  ]);

  const driftByBranch = new Map(drifts.map((d) => [d.branchId, d]));
  const now = Date.now();
  const staleNames: string[] = [];
  for (const b of branches) {
    if (branchId && b.id !== branchId) continue;
    const last = driftByBranch.get(b.id)?.lastCollectionAt ?? null;
    const daysSince = last
      ? Math.floor((now - last.getTime()) / DAY_MS)
      : 999;
    if (daysSince >= 5) staleNames.push(b.name);
  }

  // Take whichever POS source is more recent (legacy or new aggregate); empty
  // aggregate must NOT silently hide a populated legacy table.
  const newPosBiz = lastRevenue?.bizDate ?? null;
  const legacyPosBiz = lastLegacyPos?.bizDate ?? null;
  const posCoverThrough =
    newPosBiz && legacyPosBiz
      ? newPosBiz > legacyPosBiz
        ? newPosBiz
        : legacyPosBiz
      : (newPosBiz ?? legacyPosBiz);
  const posCoverDaysAgo = posCoverThrough
    ? Math.floor((now - posCoverThrough.getTime()) / DAY_MS)
    : null;

  const lastCollectionLabel = lastCollectionAll
    ? branchId
      ? formatDateTime(lastCollectionAll.collectedAt)
      : `${formatDateTime(lastCollectionAll.collectedAt)} · ${lastCollectionAll.maid.displayName} (${lastCollectionAll.branch.name})`
    : null;

  return {
    cumulativeDrift: Math.round(cum),
    monthlyTrend,
    intent,
    spark: spark.length ? spark : [0],
    freshness: {
      lastPosUploadAt: lastImport?.uploadedAt
        ? formatDateTime(lastImport.uploadedAt)
        : null,
      posCoverThrough: posCoverThrough ? isoDay(posCoverThrough) : null,
      posCoverDaysAgo,
      lastCollectionLabel,
      staleBranchCount: staleNames.length,
      staleBranchNames: staleNames.slice(0, 2),
    },
  };
}

function formatDateTime(d: Date): string {
  // Bangkok-ish compact stamp "YYYY-MM-DD HH:mm" without pulling date-fns-tz
  // here (overview is a light header). Drift-engine/format owns the canonical
  // Thai formatting elsewhere.
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = new Date(d.getTime() + 7 * 3_600_000); // +07:00
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

// ----------------------------------------------------------------
// 2) LEDGER — bank-statement rows (newest first, capped)
// CEO 2026-06-02: support `from`/`to` filter (POS-complete days only),
// default to last-30-days ending at posCoverThrough so the page opens
// straight on the latest uploaded data instead of an empty stretch.
// ----------------------------------------------------------------
export async function getReconcileLedger(args: {
  orgId: string;
  branchId?: string;
  take?: number;
  from?: string; // "YYYY-MM-DD" inclusive
  to?: string;   // "YYYY-MM-DD" inclusive
}): Promise<LedgerDay[]> {
  const { orgId, branchId, from, to } = args;
  const take = args.take ?? 200;
  // Build a wide ledger then slice; cheap because per-branch row count is small.
  const ledger = await buildLedger({ orgId, branchId, days: 365 });
  let scoped = ledger;
  if (from || to) {
    scoped = ledger.filter((d) => {
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      return true;
    });
  }
  return scoped.slice(-take).reverse();
}

// expose intent helper for the page (keeps coloring logic in one place)
export function ledgerDiffClass(d: LedgerDay): "crit" | "warn" | "ok" | "muted" {
  const i = diffIntent(d.diff, d.collected);
  return i === "warn" ? "warn" : i;
}
export function ledgerCumClass(d: LedgerDay): "crit" | "warn" | "ok" | "muted" {
  if (d.cumDrift < -500) return "crit";
  if (d.cumDrift < -100) return "warn";
  if (d.cumDrift > 100) return "ok";
  return "muted";
}

// ----------------------------------------------------------------
// 3) TIMELINE — cumulative POS vs cumulative deposit series
// ----------------------------------------------------------------
export async function getReconcileTimeline(args: {
  orgId: string;
  branchId?: string;
  days?: number;
}): Promise<TimelinePoint[]> {
  const { orgId, branchId } = args;
  const days = args.days ?? 60;
  const ledger = await buildLedger({ orgId, branchId, days });
  let cumPos = 0;
  let cumDep = 0;
  return ledger.slice(-days).map((d) => {
    cumPos += d.totalRev;
    cumDep += d.deposit ?? 0;
    return { date: d.date, cumPos, cumDep, collected: d.collected };
  });
}

// ----------------------------------------------------------------
// 4) PERIODS — collection windows (each maid round = one period)
// ----------------------------------------------------------------
export async function getReconcilePeriods(args: {
  orgId: string;
  branchId?: string;
}): Promise<PeriodWindow[]> {
  const { orgId, branchId } = args;
  const ledger = await buildLedger({ orgId, branchId, days: 365 });
  if (ledger.length === 0) return [];

  const today = ledger[ledger.length - 1].date;
  const wins: PeriodWindow[] = [];
  let from = ledger[0].date;
  let posSum = 0;
  let cashSum = 0;
  let lastDriftBefore = 0;

  ledger.forEach((d, i) => {
    posSum += d.totalRev;
    cashSum += d.cashTotal;
    if (d.collected) {
      const diff = d.diff;
      wins.push({
        from,
        to: d.date,
        days: i === 0 ? 1 : Math.max(1, daysBetween(from, d.date) + 1),
        posSum,
        cashSum,
        deposit: d.deposit,
        slip: d.slip,
        diff,
        cumBefore: lastDriftBefore,
        cumAfter: d.cumDrift,
        open: false,
        intent: Math.abs(diff) < 100 ? "ok" : "crit",
      });
      lastDriftBefore = d.cumDrift;
      posSum = 0;
      cashSum = 0;
      from = nextDate(d.date);
    }
  });

  // Open (pending) window at the tail.
  if (posSum > 0) {
    wins.push({
      from,
      to: today,
      days: Math.max(1, daysBetween(from, today) + 1),
      posSum,
      cashSum,
      deposit: null,
      slip: null,
      diff: null,
      cumBefore: lastDriftBefore,
      cumAfter: lastDriftBefore,
      open: true,
      intent: "warn",
    });
  }

  return wins.reverse().slice(0, 12);
}

// ----------------------------------------------------------------
// SIDEBAR — branch list rows (cumulative drift chip + status dot)
// ----------------------------------------------------------------
export async function getReconcileSidebar(args: {
  orgId: string;
}): Promise<ReconcileSidebarRow[]> {
  const { orgId } = args;
  const [branches, drifts] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, mallGroup: true },
    }),
    prisma.chairopsDrift.findMany({
      where: { orgId },
      select: {
        branchId: true,
        driftAmount: true,
        driftSince: true,
        lastCollectionAt: true,
        daysSinceLastCollection: true,
      },
    }),
  ]);
  const driftByBranch = new Map(drifts.map((d) => [d.branchId, d]));

  const rows = branches.map((b) => {
    const d = driftByBranch.get(b.id);
    // drift-engine convention: positive = shortage. Mockup chip wants signed
    // "drift" where negative = shortage → invert for display parity.
    const driftAmount = d?.driftAmount ?? 0;
    const cumDrift = -driftAmount;
    const daysSince = d?.daysSinceLastCollection ?? 999;
    let status: ReconcileSidebarRow["status"] = "ok";
    if (daysSince > 1) status = "missed";
    else if (driftAmount > 0) status = "critical";
    else if (driftAmount < -100) status = "warn";
    return {
      branchId: b.id,
      name: b.name,
      mallLabel: resolveMall(b.mallGroup).label,
      status,
      cumDrift,
      daysSinceCollect: daysSince,
    };
  });

  // Worst (most negative cumDrift) first to match mockup ordering.
  return rows.sort((a, b) => a.cumDrift - b.cumDrift);
}
