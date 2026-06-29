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
//   cash        = cashTotal            (StarThing "จ่ายเงินสด" · physical cash in baht)
//   coin        = coinInsertCount      (StarThing "จำนวนหยอดเหรียญ" · COUNT of coin
//                                       insertions, NOT baht)
//   coinBaht    = coinInsertCount × COIN_BAHT (10) — CEO 2026-06-25: StarThing
//                                       does NOT include coin revenue in its
//                                       cash/gross totals, and the maid collects
//                                       the coin box too, so coin baht is added
//                                       into BOTH cashTotal AND totalRev (and
//                                       therefore pending/drift). See
//                                       [[chairops-coin-into-total-and-drift-2026-06-25]].
//   cashTotal   = cashTotal + coinBaht (cash the maid must hand in · = "รวมเงินสด")
//   totalRev    = grossTotal + coinBaht
//   deposit     = ChairopsCashCollection.depositedAmount (bucketed to bizDate)
//
// Drift convention here matches the MOCKUP (diff = deposit − expectedCash, so
// NEGATIVE = shortage), which is the inverse of the drift-engine's positive=
// shortage. The drift-engine applies the SAME coin-into-cash rule (via the
// shared COIN_BAHT constant) so its persisted shortage and this display ledger
// stay in agreement ([[chairops-no-cumulative-shortage]]).
//
// All reads filter by orgId (Pool multi-tenant · no hardcoded org).
// References: [[chairops-starthing-xlsx-schema-2026-05-27]] ·
//   [[chairops-maid-schedule-irregular]] · [[react-cache-on-getsession-pattern]]
// ============================================================

import { prisma } from "@/lib/prisma";
import { resolveMall } from "@/lib/chairops/utils/mall-groups";
import { getDepositsByDate } from "@/lib/chairops/queries/_deposits";
import { coinBahtOf } from "@/lib/chairops/reconcile/constants";

// ----------------------------------------------------------------
// Public types — shaped to drive the UI directly
// ----------------------------------------------------------------
/** Source provenance for each collection row aggregated into a ledger day. */
export type LedgerDaySource = "MAID_MANUAL" | "CSV_IMPORT" | "OFFICE_PROXY";

export interface LedgerDay {
  date: string; // "YYYY-MM-DD"
  online: number;
  cash: number;
  coin: number; // COUNT of coin insertions ("จำนวนหยอดเหรียญ") · NOT baht
  coinBaht: number; // = coin × COIN_BAHT (10) · the coin revenue StarThing omits
  cashTotal: number; // = cash + coinBaht (cash maid must hand in · "รวมเงินสด")
  totalRev: number; // = grossTotal (or online+cash) + coinBaht
  deposit: number | null; // null = no collection that day
  /**
   * Σ countedAmount of collections on this day that are NOT yet linked to a
   * bank deposit (depositId IS NULL). CEO 2026-06-25: "เก็บแล้วแต่ยังไม่ฝาก" —
   * cash the maid has counted/handed to the office but hasn't reached the bank.
   * Surfaces CSV-imported collection rounds (which carry depositId=null) that
   * were otherwise invisible in the money columns.
   */
  collectedNotDeposited: number;
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
  /**
   * F1 (audit MISS-04 · 2026-06-02) · what provenance(s) the collection rows
   * for this day came from. A day with both MAID_MANUAL and CSV_IMPORT entries
   * shows two pills · used by LedgerTab.
   */
  sources: LedgerDaySource[];
  /**
   * True when at least one collection on this day is CSV_IMPORT WITHOUT
   * slipPhotoUrl. Drives the "ยังไม่มีสลิป" filter chip.
   */
  hasCsvWithoutSlip: boolean;
  /**
   * Net approved write-off effective on THIS day (SHORT = +amount · OVER =
   * −amount). Non-zero → the ledger row is highlighted so the CEO sees WHY the
   * running drift jumped toward 0 right here (CEO 2026-06-25 "โชว์ในตารางตรงวันที่
   * เงินหาย"). 0 on normal days.
   */
  writeOffNet: number;
  /** Pre-formatted hover tooltip describing the write-off(s) on this day · null if none. */
  writeOffNote: string | null;
}

export interface LedgerTotals {
  online: number;
  cash: number;
  coin: number;
  coinBaht: number;
  cashTotal: number;
  totalRev: number;
  deposit: number;
  /** Σ collected-but-not-deposited across the visible window (CEO 2026-06-25). */
  collectedNotDeposited: number;
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
  // Bangkok-local day grain (UTC+7). Safe for DATE columns (midnight UTC →
  // midnight+7h stays same date) and correct for DATETIME columns where
  // an event at 00:15 Bangkok (17:15 UTC prev day) must bucket to Bangkok date.
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
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
  /** Explicit lower bound · overrides `days`. Use for all-time / custom ranges
   *  so the cumulative drift is computed from the branch's full history. */
  since?: Date;
}): Promise<LedgerDay[]> {
  const { orgId, branchId, days } = args;
  const since = args.since ?? startOfDayMinus(days);

  const branchFilter = branchId ? { branchId } : {};

  // POS daily rows (new aggregate table)
  const revenueRows = await prisma.chairopsBranchDailyRevenue.findMany({
    where: { orgId, ...branchFilter, bizDate: { gte: since } },
    select: {
      bizDate: true,
      onlineTotal: true,
      cashTotal: true,
      coinInsertCount: true,
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
      // coin = "จำนวนหยอดเหรียญ" → count of coin insertions (NOT baht). The coin
      // baht is added separately below (coinBahtOf) since StarThing omits it.
      prev.coin += r.coinInsertCount;
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
        coinInsertCount: true,
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
      // coin = "จำนวนหยอดเหรียญ" → count of coin insertions (NOT baht). The coin
      // baht is added separately below (coinBahtOf) since StarThing omits it.
      prev.coin += r.coinInsertCount;
      prev.total += toNum(r.grossTotal);
      posByDay.set(key, prev);
    }
  }

  // Deposits per day — drift-engine formula (CashDeposit + bankFee + legacy
  // CashCollection.depositedAmount where depositId IS NULL). Was reading the
  // now-dead `CashCollection.depositedAmount` column directly, which made the
  // ledger "ฝาก" column read 0 every day after Wave-2 even though the maid
  // had actually deposited (CEO complaint: "sidebar −22,761 แต่ ledger 0").
  // Slip refs are fetched separately (collection rows still carry photo
  // pointers regardless of where the cash amount lives).
  const [depByDayAmount, slipCollections] = await Promise.all([
    getDepositsByDate({ orgId, branchId, since }),
    prisma.chairopsCashCollection.findMany({
      where: { orgId, ...branchFilter, collectedAt: { gte: since } },
      select: {
        collectedAt: true,
        slipPhotoUrl: true,
        evidencePhotoUrl: true,
        // F1 (audit MISS-04 · 2026-06-02) — surface provenance + missing-slip
        // signal to LedgerTab. `source` may be null on legacy rows because the
        // CHECK constraint was added in 20260602153000 — fall back to MAID_MANUAL.
        source: true,
        // CEO 2026-06-25 "เก็บแล้วยังไม่ฝาก" — depositId IS NULL means this
        // collected cash has not been linked to a bank deposit yet.
        depositId: true,
        countedAmount: true,
      },
      orderBy: { collectedAt: "asc" },
    }),
  ]);

  // CEO 2026-06-25 · Σ collected-but-not-deposited per day (depositId IS NULL).
  const collectedNotDepByDay = new Map<string, number>();
  for (const c of slipCollections) {
    if (c.depositId != null) continue;
    const key = isoDay(c.collectedAt);
    collectedNotDepByDay.set(
      key,
      (collectedNotDepByDay.get(key) ?? 0) + c.countedAmount,
    );
  }
  const slipByDay = new Map<string, string>();
  for (const c of slipCollections) {
    const key = isoDay(c.collectedAt);
    if (slipByDay.has(key)) continue;
    const slip = c.slipPhotoUrl ?? c.evidencePhotoUrl ?? "slip";
    slipByDay.set(key, slip);
  }
  // Build per-day source-set and missing-slip flag (F1 · audit MISS-04).
  const sourcesByDay = new Map<string, Set<LedgerDaySource>>();
  const csvMissingSlipByDay = new Set<string>();
  for (const c of slipCollections) {
    const key = isoDay(c.collectedAt);
    const src = (c.source ?? "MAID_MANUAL") as LedgerDaySource;
    const set = sourcesByDay.get(key) ?? new Set<LedgerDaySource>();
    set.add(src);
    sourcesByDay.set(key, set);
    if (src === "CSV_IMPORT" && !c.slipPhotoUrl) {
      csvMissingSlipByDay.add(key);
    }
  }
  const depByDay = new Map<string, { deposit: number; slip: string | null }>();
  for (const [key, deposit] of depByDayAmount) {
    depByDay.set(key, { deposit, slip: slipByDay.get(key) ?? "slip" });
  }

  // Approved write-offs settle the running shortage as of their effectiveDate
  // (CEO 2026-06-25 "ตั้งต้นใหม่"). We fold the NET effect (SHORT = +amount ·
  // OVER = −amount) into cumDrift so the ledger footer/hero MATCH the engine
  // (ChairopsDrift) after a write-off — otherwise the sidebar drops but the
  // table doesn't = "ตัวเลขโกหก" ([[chairops-coin-into-total-and-drift-2026-06-25]]
  // "money table มี 2 read-path ต้องแก้ให้ครบ").
  const writeOffRows = await prisma.chairopsWriteOff.findMany({
    where: { orgId, ...branchFilter, status: "APPROVED" },
    select: { amount: true, direction: true, effectiveDate: true, makerAt: true, reason: true },
  });
  const sinceDay = isoDay(since);
  const netWoByDay = new Map<string, number>();
  const woNoteByDay = new Map<string, string[]>(); // hover-tooltip lines per day
  let priorWriteOff = 0; // net write-off effective BEFORE the visible window
  for (const w of writeOffRows) {
    const eff = w.effectiveDate ?? w.makerAt;
    const key = isoDay(eff);
    const signed = w.direction === "OVER" ? -w.amount : w.amount;
    if (key < sinceDay) {
      priorWriteOff += signed;
      continue;
    }
    netWoByDay.set(key, (netWoByDay.get(key) ?? 0) + signed);
    const label = w.direction === "OVER" ? "ตัดเงินเกิน" : "ตัดเงินขาด";
    const lines = woNoteByDay.get(key) ?? [];
    lines.push(`${label} ${w.amount.toLocaleString()}฿ — ${w.reason}`);
    woNoteByDay.set(key, lines);
  }

  // Union of all days present in any source, sorted ascending.
  const allDays = new Set<string>([
    ...posByDay.keys(),
    ...depByDay.keys(),
    ...netWoByDay.keys(),
    ...collectedNotDepByDay.keys(),
  ]);
  const sortedDays = [...allDays].sort();

  let closedDrift = 0;
  let pending = 0;
  let cumWriteOff = priorWriteOff; // accumulates day-by-day across the window
  const ledger: LedgerDay[] = [];
  for (const date of sortedDays) {
    const pos = posByDay.get(date) ?? { online: 0, cash: 0, coin: 0, total: 0 };
    // CEO 2026-06-25: pos.coin is a COUNT of coin insertions (not baht), and
    // StarThing does NOT include that coin revenue in cash/gross. The maid
    // empties the coin box too, so coin baht (count × COIN_BAHT) is real cash
    // she must hand in → fold it into BOTH cashTotal (→ pending/drift) AND the
    // revenue total. The drift-engine applies the same rule so the numbers
    // agree. See [[chairops-coin-into-total-and-drift-2026-06-25]].
    const coinBaht = coinBahtOf(pos.coin);
    const cashTotal = pos.cash + coinBaht;
    const totalRev = (pos.total || pos.online + pos.cash) + coinBaht;
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

    // Approved write-offs effective on/before this day move cumDrift toward 0
    // (SHORT forgives a shortage · OVER cancels a surplus). Matches the engine's
    // depositTotal += netWriteOff, so −cumDrift === engine driftAmount.
    const woNetToday = netWoByDay.get(date) ?? 0;
    cumWriteOff += woNetToday;
    const woNoteLines = woNoteByDay.get(date);

    ledger.push({
      date,
      online: pos.online,
      cash: pos.cash,
      coin: pos.coin,
      coinBaht,
      cashTotal,
      totalRev,
      deposit,
      collectedNotDeposited: collectedNotDepByDay.get(date) ?? 0,
      slip,
      collected,
      diff: collected ? diff : 0,
      closedDrift,
      // CEO 2026-06-02: cumDrift must reflect OPEN pending too · otherwise a
      // branch that never collects shows 0 cumDrift forever while the side
      // panel/engine show −22,761. Negative = owed by branch (shortage).
      // CEO 2026-06-25: + cumWriteOff so an approved "ตั้งต้น" write-off pulls
      // this running drift toward 0 in lock-step with the engine/sidebar.
      cumDrift: closedDrift - pending + cumWriteOff,
      pending,
      sources: Array.from(sourcesByDay.get(date) ?? []),
      hasCsvWithoutSlip: csvMissingSlipByDay.has(date),
      writeOffNet: woNetToday,
      writeOffNote: woNoteLines ? woNoteLines.join(" · ") : null,
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
    coinBaht: 0,
    cashTotal: 0,
    totalRev: 0,
    deposit: 0,
    collectedNotDeposited: 0,
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
    t.coinBaht += r.coinBaht;
    t.cashTotal += r.cashTotal;
    t.totalRev += r.totalRev;
    t.deposit += r.deposit ?? 0;
    t.collectedNotDeposited += r.collectedNotDeposited;
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
  /** CEO 2026-06-25: load the branch's FULL history (no 365-day window) so the
   *  "ทั้งหมด" preset and old custom ranges actually show every day. */
  allTime?: boolean;
}): Promise<LedgerDay[]> {
  const { orgId, branchId, from, to, allTime } = args;
  // How far back to build so the cumulative covers the visible window:
  //  • allTime          → from epoch (full history)
  //  • custom `from`     → from that date when it's older than the 365d default
  //  • else              → last 365 days (unchanged default)
  let since: Date | undefined;
  if (allTime) {
    since = new Date(0);
  } else if (from) {
    const fromDate = new Date(from + "T00:00:00+07:00");
    const d365 = startOfDayMinus(365);
    if (fromDate < d365) since = fromDate;
  }
  const ledger = await buildLedger({ orgId, branchId, days: 365, since });
  let scoped = ledger;
  if (from || to) {
    scoped = ledger.filter((d) => {
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      return true;
    });
  }
  const newestFirst = scoped.slice().reverse();
  // Only cap the DEFAULT "no selection" view. Custom ranges + allTime return
  // every row (the shell paginates for display · CEO 2026-06-25 "ดูทั้งหมด").
  if (args.take != null && !allTime && !from && !to) {
    return newestFirst.slice(0, args.take);
  }
  return newestFirst;
}

// ----------------------------------------------------------------
// DAY DETAIL — drill-down chunks for ONE day (CEO 2026-06-25).
// Clicking a ledger day shows the individual collection rounds + bank
// deposits that make up that day's numbers, so a backdated CSV import is
// no longer an opaque lump. Aging (days held) is computed for collections
// that are still un-deposited.
// ----------------------------------------------------------------
export interface DayDetailCollection {
  id: string;
  collectedAt: string;          // ISO datetime (Bangkok)
  maidName: string;
  countedAmount: number;
  source: LedgerDaySource;
  deposited: boolean;           // depositId != null
  daysHeld: number | null;      // today − collectedAt (only when not deposited)
  slipUrl: string | null;
}
export interface DayDetailDeposit {
  id: string;
  depositedAt: string;
  maidName: string;
  depositedAmount: number;
  bankFee: number;
  slipUrl: string | null;
}
// CEO 2026-06-29: write-offs ("ตัดเงิน/ตั้งต้น") effective on this day, so the
// ✂️ marker in the ledger row can drill straight into who cut how much and why.
export interface DayDetailWriteOff {
  id: string;
  amount: number;
  direction: string;            // "SHORT" (เงินขาด) | "OVER" (เงินเกิน)
  reason: string;
  status: string;               // "PENDING" | "APPROVED"
  effectiveDate: string | null; // "YYYY-MM-DD" — ตั้งต้น ณ วันไหน
  makerName: string;
  makerAt: string;
  approverName: string | null;
  approverAt: string | null;
}
export interface DayDetailSourceTotal {
  count: number;
  total: number;
}
export interface ReconcileDayDetail {
  date: string;
  collections: DayDetailCollection[];
  deposits: DayDetailDeposit[];
  writeOffs: DayDetailWriteOff[];
  collectedTotal: number;
  collectedNotDepositedTotal: number;
  depositTotal: number;
  // CEO 2026-06-29: split this day's collections by ORIGIN so a backfilled CSV
  // import is never lumped together with money the maid actually keyed/handed in.
  bySource: {
    maidManual: DayDetailSourceTotal;
    csvImport: DayDetailSourceTotal;
    officeProxy: DayDetailSourceTotal;
  };
}

export async function getReconcileDayDetail(args: {
  orgId: string;
  branchId?: string;
  day: string; // "YYYY-MM-DD" (Bangkok)
}): Promise<ReconcileDayDetail> {
  const { orgId, branchId, day } = args;
  const branchFilter = branchId ? { branchId } : {};
  // Bangkok day window → [day 00:00+07, next day 00:00+07)
  const start = new Date(day + "T00:00:00+07:00");
  const end = new Date(start.getTime() + DAY_MS);

  const [collections, deposits, writeOffsRaw] = await Promise.all([
    prisma.chairopsCashCollection.findMany({
      where: { orgId, ...branchFilter, collectedAt: { gte: start, lt: end } },
      select: {
        id: true,
        collectedAt: true,
        countedAmount: true,
        source: true,
        depositId: true,
        slipPhotoUrl: true,
        evidencePhotoUrl: true,
        maid: { select: { displayName: true } },
      },
      orderBy: { collectedAt: "asc" },
    }),
    prisma.chairopsCashDeposit.findMany({
      where: { orgId, ...branchFilter, depositedAt: { gte: start, lt: end } },
      select: {
        id: true,
        depositedAt: true,
        depositedAmount: true,
        bankFee: true,
        slipPhotoUrl: true,
        maid: { select: { displayName: true } },
      },
      orderBy: { depositedAt: "asc" },
    }),
    // CEO 2026-06-29: write-offs are keyed by isoDay(effectiveDate ?? makerAt) —
    // the SAME bucket buildLedger uses for the ✂️ marker — so we fetch the
    // branch's PENDING+APPROVED write-offs and filter in JS to match exactly.
    prisma.chairopsWriteOff.findMany({
      where: { orgId, ...branchFilter, status: { in: ["PENDING", "APPROVED"] } },
      select: {
        id: true,
        amount: true,
        direction: true,
        reason: true,
        status: true,
        effectiveDate: true,
        makerAt: true,
        approverAt: true,
        maker: { select: { displayName: true } },
        approver: { select: { displayName: true } },
      },
      orderBy: [{ effectiveDate: "desc" }, { makerAt: "desc" }],
    }),
  ]);

  const now = Date.now();
  const collOut: DayDetailCollection[] = collections.map((c) => ({
    id: c.id,
    collectedAt: formatDateTime(c.collectedAt),
    maidName: c.maid?.displayName ?? "—",
    countedAmount: c.countedAmount,
    source: (c.source ?? "MAID_MANUAL") as LedgerDaySource,
    deposited: c.depositId != null,
    daysHeld:
      c.depositId == null
        ? Math.max(0, Math.floor((now - c.collectedAt.getTime()) / DAY_MS))
        : null,
    slipUrl: c.slipPhotoUrl ?? c.evidencePhotoUrl ?? null,
  }));
  const depOut: DayDetailDeposit[] = deposits.map((d) => ({
    id: d.id,
    depositedAt: formatDateTime(d.depositedAt),
    maidName: d.maid?.displayName ?? "—",
    depositedAmount: d.depositedAmount,
    bankFee: d.bankFee,
    slipUrl: d.slipPhotoUrl ?? null,
  }));

  // CEO 2026-06-29: per-origin split (มือ / CSV / Office) for this day's
  // collections — surfaces "how much was backfilled by CSV vs handed in by the
  // maid" so the merged total is no longer confusing.
  const bySource = {
    maidManual: { count: 0, total: 0 },
    csvImport: { count: 0, total: 0 },
    officeProxy: { count: 0, total: 0 },
  };
  for (const c of collOut) {
    const bucket =
      c.source === "CSV_IMPORT"
        ? bySource.csvImport
        : c.source === "OFFICE_PROXY"
          ? bySource.officeProxy
          : bySource.maidManual;
    bucket.count += 1;
    bucket.total += c.countedAmount;
  }

  const writeOffs: DayDetailWriteOff[] = writeOffsRaw
    .filter((w) => isoDay(w.effectiveDate ?? w.makerAt) === day)
    .map((w) => ({
      id: w.id,
      amount: w.amount,
      direction: w.direction,
      reason: w.reason,
      status: w.status,
      effectiveDate: w.effectiveDate ? isoDay(w.effectiveDate) : null,
      makerName: w.maker?.displayName ?? "—",
      makerAt: formatDateTime(w.makerAt),
      approverName: w.approver?.displayName ?? null,
      approverAt: w.approverAt ? formatDateTime(w.approverAt) : null,
    }));

  return {
    date: day,
    collections: collOut,
    deposits: depOut,
    writeOffs,
    collectedTotal: collOut.reduce((s, c) => s + c.countedAmount, 0),
    collectedNotDepositedTotal: collOut
      .filter((c) => !c.deposited)
      .reduce((s, c) => s + c.countedAmount, 0),
    depositTotal: depOut.reduce((s, d) => s + d.depositedAmount + d.bankFee, 0),
    bySource,
  };
}

// ----------------------------------------------------------------
// PER-CHAIR — deep-dive: each massage chair's POS sales (ควรได้) vs what the
// maid actually counted/collected (เก็บได้) → variance per machine, so the CEO
// can see WHICH chair is short/over (CEO 2026-06-29). Collected-per-chair comes
// from ChairopsCashCollection.chairBreakdown (only MAID_MANUAL form entries set
// it — CSV/legacy rows have no breakdown → surfaced as "unattributed"). Expected
// uses the SAME cash formula as the ledger: PosDaily.cashTotal + coin×10.
// ----------------------------------------------------------------
export interface PerChairRow {
  chairCode: string;
  generation: string | null;
  expected: number; // POS cash + coin baht (ควรได้) · over the window
  collected: number; // maid-counted per chair (เก็บได้) · over the window
  variance: number; // collected − expected (− = ขาด · + = เกิน)
  hasPos: boolean;
  hasCollection: boolean;
  brokenOrEmpty: boolean; // any chairBreakdown line ≠ "collected"
}
export interface ReconcilePerChair {
  from: string;
  to: string;
  rows: PerChairRow[];
  totals: { expected: number; collected: number; variance: number };
  /** collected via CSV/legacy rows with no per-chair breakdown — cannot map to a chair. */
  unattributedCollected: number;
  unattributedCount: number;
  /** POS cash on rows with no chairCode — counted in totals.expected but not in any chair row. */
  unattributedExpected: number;
  unattributedExpectedCount: number;
}

function isoMinusDaysLocal(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getReconcilePerChair(args: {
  orgId: string;
  branchId: string;
  from?: string;
  to?: string;
  allTime?: boolean;
  posCoverThrough?: string | null;
}): Promise<ReconcilePerChair> {
  const { orgId, branchId } = args;

  // Resolve the [fromDay, toDay] window (mirrors the ledger's default: last 30
  // days ending at the latest POS-complete day when no explicit range is set).
  let fromDay: string;
  let toDay: string;
  if (args.allTime) {
    fromDay = "1970-01-01";
    toDay = isoDay(new Date());
  } else if (args.from || args.to) {
    fromDay = args.from ?? "1970-01-01";
    toDay = args.to ?? isoDay(new Date());
  } else {
    // Default window mirrors the ledger's: last 30 days STARTING at posThrough-29
    // but ending TODAY (not posThrough) — else a collection made after the last
    // POS upload is hidden and the chair wrongly reads as ขาด (verify P2 · the
    // ledger made the same fix, reconcile-shell defaultedLedger).
    const anchor = args.posCoverThrough ?? isoDay(new Date());
    fromDay = isoMinusDaysLocal(anchor, 29);
    toDay = isoDay(new Date());
  }
  // bizDate is @db.Date (UTC midnight) → compare with plain date boundaries.
  const bizStart = new Date(fromDay);
  const bizEnd = new Date(toDay);
  // collectedAt is a full instant → Bangkok day window [from 00:00+07, to+1 00:00+07).
  const collStart = new Date(fromDay + "T00:00:00+07:00");
  const collEnd = new Date(new Date(toDay + "T00:00:00+07:00").getTime() + DAY_MS);

  const [chairs, posRows, collections] = await Promise.all([
    prisma.chairopsChair.findMany({
      where: { orgId, branchId, isActive: true },
      select: { chairCode: true, generation: true },
    }),
    prisma.chairopsPosDaily.findMany({
      where: { orgId, branchId, bizDate: { gte: bizStart, lte: bizEnd } },
      select: { chairCode: true, cashTotal: true, coinInsertCount: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: { orgId, branchId, collectedAt: { gte: collStart, lt: collEnd } },
      select: { countedAmount: true, chairBreakdown: true },
    }),
  ]);

  // Expected cash per chair = Σ(cashTotal) + Σ(coin)×10 — same as buildLedger.
  // POS rows with no chairCode (the ingest allows them) go to an "unattributed"
  // bucket that STILL counts in totals.expected — else the tab's ขาด/เกินรวม
  // under-reports shortage vs the ledger (verify P1).
  const expectedByChair = new Map<string, number>();
  let unattributedExpected = 0;
  let unattributedExpectedCount = 0;
  for (const p of posRows) {
    const exp = toNum(p.cashTotal) + coinBahtOf(p.coinInsertCount);
    if (!p.chairCode) {
      unattributedExpected += exp;
      unattributedExpectedCount += 1;
      continue;
    }
    expectedByChair.set(p.chairCode, (expectedByChair.get(p.chairCode) ?? 0) + exp);
  }

  // Collected per chair from the maid's chairBreakdown (MAID_MANUAL only).
  const collectedByChair = new Map<string, number>();
  const brokenByChair = new Set<string>();
  let unattributedCollected = 0;
  let unattributedCount = 0;
  for (const c of collections) {
    const bd = c.chairBreakdown as { lines?: unknown } | null;
    const lines = bd && Array.isArray(bd.lines)
      ? (bd.lines as Array<Record<string, unknown>>)
      : null;
    if (!lines || lines.length === 0) {
      unattributedCollected += c.countedAmount;
      unattributedCount += 1;
      continue;
    }
    // A line with a blank chairCode (only via malformed/legacy JSON — the writer
    // validates codes) still carries money → fold into the unattributed bucket
    // instead of silently dropping it, so totals.collected never loses baht.
    let blankMoneyInColl = false;
    for (const ln of lines) {
      const code = typeof ln.chairCode === "string" ? ln.chairCode.trim() : "";
      const amt = typeof ln.amount === "number" ? ln.amount : 0;
      if (!code) {
        if (amt > 0) {
          unattributedCollected += amt;
          blankMoneyInColl = true;
        }
        continue;
      }
      collectedByChair.set(code, (collectedByChair.get(code) ?? 0) + amt);
      const status = typeof ln.status === "string" ? ln.status : "";
      if (status && status !== "collected") brokenByChair.add(code);
    }
    if (blankMoneyInColl) unattributedCount += 1;
  }

  const genByCode = new Map(chairs.map((c) => [c.chairCode, c.generation]));
  const allCodes = new Set<string>([
    ...chairs.map((c) => c.chairCode),
    ...expectedByChair.keys(),
    ...collectedByChair.keys(),
  ]);
  const rows: PerChairRow[] = [...allCodes].map((code) => {
    const expected = Math.round(expectedByChair.get(code) ?? 0);
    const collected = Math.round(collectedByChair.get(code) ?? 0);
    return {
      chairCode: code,
      generation: genByCode.get(code) ?? null,
      expected,
      collected,
      variance: collected - expected,
      hasPos: expectedByChair.has(code),
      hasCollection: collectedByChair.has(code),
      brokenOrEmpty: brokenByChair.has(code),
    };
  });
  // Worst shortage first (most negative variance), then by code.
  rows.sort(
    (a, b) => a.variance - b.variance || a.chairCode.localeCompare(b.chairCode),
  );

  // Sum the ALREADY-ROUNDED per-row values + the rounded unattributed buckets
  // so the footer total always equals Σ(visible rows) + disclosed unattributed
  // (no per-row-vs-total drift · verify P2).
  const unExp = Math.round(unattributedExpected);
  const unColl = Math.round(unattributedCollected);
  const totalExpected = rows.reduce((s, r) => s + r.expected, 0) + unExp;
  const totalCollected = rows.reduce((s, r) => s + r.collected, 0) + unColl;

  return {
    from: fromDay,
    to: toDay,
    rows,
    totals: {
      expected: totalExpected,
      collected: totalCollected,
      variance: totalCollected - totalExpected,
    },
    unattributedCollected: unColl,
    unattributedCount,
    unattributedExpected: unExp,
    unattributedExpectedCount,
  };
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
    // "critical" (money shortage) beats "missed" — a branch with both a
    // shortage AND no recent collection needs the revenue-recovery action, not
    // just the collection reminder. Sprint-1 fix (UAT finding MISS-06).
    let status: ReconcileSidebarRow["status"] = "ok";
    if (driftAmount > 0) status = "critical";
    else if (driftAmount < -100) status = "warn";
    else if (daysSince > 1) status = "missed";
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
