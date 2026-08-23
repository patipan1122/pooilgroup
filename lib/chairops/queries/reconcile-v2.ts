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
  // CEO 2026-08-17: ยอดต่อใบฝากของวันนี้ (เหมือนตาราง Periods) — undefined จาก
  // buildLedger() เอง (ไม่ได้ตั้งใจแก้ shared function นี้ · ของเดิมทุกจุดยังทำงาน
  // เหมือนเดิม) · getReconcileLedger() เติมให้หลังเรียก buildLedger() แล้วเท่านั้น.
  slips?: PeriodSlip[];
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

// CEO 2026-08-17: ยอดต่อ "ใบฝาก" เดียว — เดิมคอลัมน์ "สลิป" ใน Periods เป็นแค่ลิงก์
// รวม (สลิปแรกของช่วง, ยอดพิมพ์รวมทั้งช่วง). พนักงานบางคนแบ่งฝากหลายรอบ/หลายใบใน
// ช่วงเดียวกัน → ต้องเห็นทีละใบพร้อมสถานะ reconcile ของใบนั้นๆ. amount = ยอดที่ AI
// อ่านจากสลิปจริง (ocrAmount) ถ้ามี ไม่งั้น fallback ไปยอดที่พนักงานพิมพ์
// (depositedAmount) — สลิปเก่าก่อน 2026-08-17 ยังไม่มี ocrAmount จะใช้ fallback นี้.
export interface PeriodSlip {
  id: string;
  depositedAt: string;
  amount: number;
  amountIsOcr: boolean;
  slipUrl: string | null;
  ledgerStatus: LedgerStatus;
  flagged: boolean; // requiresReview — สลิปซ้ำ/บัญชีผิด/ผลต่าง≥500 ยังไม่ผ่านตรวจ
}

export interface PeriodWindow {
  from: string;
  to: string;
  days: number;
  posSum: number;
  cashSum: number; // expected cash maid should hand in
  deposit: number | null;
  slip: string | null;
  slips: PeriodSlip[];
  diff: number | null; // null when window still open
  cumBefore: number;
  cumAfter: number;
  open: boolean;
  intent: "crit" | "warn" | "ok";
  // CEO 2026-06-30 (Pinpoint #3) · real collection clock-times + who collected,
  // so each "รอบเก็บ" shows เก็บครั้งก่อน→ครั้งนี้ + สถานะคนเก็บ (มือ/CSV/แอดมิน).
  // collectedSum = Σ countedAmount of (non-deleted) collections inside this
  // window · first/lastCollectedAt = formatted "YYYY-MM-DD HH:mm".
  collectedSum: number;
  firstCollectedAt: string | null;
  lastCollectedAt: string | null;
  collectors: LedgerDaySource[]; // distinct sources present in the window
  bySource: {
    maidManual: DayDetailSourceTotal;
    csvImport: DayDetailSourceTotal;
    officeProxy: DayDetailSourceTotal;
  };
  // CEO 2026-07-01 · TIME-WINDOWED anti-fraud (per branch · meter-based · DISPLAY-ONLY).
  // "ควรได้ตามเวลา" = Σ meter delta across machines in [prev collection time →
  // this collection time] — the sales the machines actually made in the exact
  // window the maid's round covers. Compared vs collectedSum (เก็บได้) to catch
  // per-round skimming/rotation. null = ⚪ ไม่มีข้อมูลมิเตอร์ / org-level view.
  expectedMeter: number | null;
  varianceMeter: number | null; // collectedSum − expectedMeter (− = ขาด/น่าสงสัย)
  verdictMeter: PerChairVerdict;
  cumShortageMeter: number | null; // running Σ variance (ตัวจับหมุนเงินระยะยาว)
  // CEO 2026-07-04 · the EXACT clock window the expectedMeter ("ควรได้") was
  // computed over = [เวลาเก็บรอบก่อน → เวลาเก็บรอบนี้], as the meter engine used
  // it. NOT the previous row's time — incomplete rounds are skipped so prevMs may
  // jump — so we surface the real boundary the math ran on. Formatted
  // "YYYY-MM-DD HH:mm". start=null → onboarding backlog (ตั้งแต่เริ่มมีข้อมูล);
  // both null → org-level view / no meter data (tooltip stays hidden).
  meterWindowStart: string | null;
  meterWindowEnd: string | null;
  // CEO 2026-07-08 · meter data for this branch is BATCHED and lags ~1 day. When the
  // maid collected AFTER the last meter reading arrived (t1 > latest meter event),
  // the meter never recorded through the collection → expectedMeter would be a
  // misleadingly-LOW number (e.g. 20 when 660 was collected → a fake +640 "drift").
  // meterPending flags those rounds → the view shows "⚪ รอมิเตอร์" instead of a
  // number and drops the variance, so a data-lag never looks like a shortage.
  // meterLatest = formatted time the meter data currently reaches ("อัปเดตถึง …").
  meterPending: boolean;
  meterLatest: string | null;
  // CEO 2026-08-17 · เก็บได้ vs ฝาก (ต่างฝาก) — neither of the two checks above
  // catches skimming AFTER collection but BEFORE the bank (คนเก็บ→ธนาคาร): the
  // meter check stops at เก็บได้, and `diff` above is deposit vs expectedCash
  // (ตู้→ธนาคาร), never against collectedSum. depositDiff = deposit − collectedSum
  // for THIS window only · null when no deposit landed in this window (timing lag,
  // not a real 0 — a maid may collect Mon and the office deposits Wed as one lump).
  // depositDiffCum = running Σ depositDiff skipping null windows — the trustworthy
  // signal (sustained negative = money collected but never reaching the bank).
  depositDiff: number | null;
  depositDiffCum: number | null;
}

export interface ReconcileSidebarRow {
  branchId: string;
  name: string;
  mallLabel: string;
  status: "ok" | "warn" | "critical" | "missed";
  cumDrift: number;
  daysSinceCollect: number;
  /** CEO 2026-07-01 · closedAt != null → สาขาปิด/ย้ายแล้ว → pin to bottom + dim. */
  isClosed: boolean;
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
  const [depByDayAmount, slipCollections, depositSlipRows] = await Promise.all([
    getDepositsByDate({ orgId, branchId, since }),
    prisma.chairopsCashCollection.findMany({
      // deletedAt: null — soft-deleted CSV imports must vanish from every money
      // column (CEO 2026-06-30). Same filter repeated on every collection read.
      where: { orgId, ...branchFilter, collectedAt: { gte: since }, deletedAt: null },
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
    // CEO 2026-06-30 (Pinpoint #1) · the "สลิป" column used to read the
    // COLLECTION's photo, which CSV imports rarely have → the slip showed as
    // grey un-clickable text. The bank-deposit slip (ChairopsCashDeposit.
    // slipPhotoUrl) is REQUIRED on every deposit, so prefer it: "กดฝากแล้ว
    // สลิปต้องขึ้นรูป".
    prisma.chairopsCashDeposit.findMany({
      where: { orgId, ...branchFilter, depositedAt: { gte: since } },
      select: { depositedAt: true, slipPhotoUrl: true },
      orderBy: { depositedAt: "asc" },
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
  // Deposit-slip per day (first real bank slip). ChairopsCashDeposit.slipPhotoUrl
  // is required → always a viewable image.
  const depositSlipByDay = new Map<string, string>();
  for (const d of depositSlipRows) {
    const key = isoDay(d.depositedAt);
    if (depositSlipByDay.has(key)) continue;
    if (d.slipPhotoUrl) depositSlipByDay.set(key, d.slipPhotoUrl);
  }
  const depByDay = new Map<string, { deposit: number; slip: string | null }>();
  for (const [key, deposit] of depByDayAmount) {
    // Prefer the bank-deposit slip (real image · CEO 2026-06-30) over the
    // collection photo; fall back to the "slip" placeholder when neither exists.
    depByDay.set(key, {
      deposit,
      slip: depositSlipByDay.get(key) ?? slipByDay.get(key) ?? "slip",
    });
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
      where: { orgId, ...(branchId ? { branchId } : {}), deletedAt: null },
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
  // CEO 2026-08-17: ยอดต่อใบฝาก ในหน้า Ledger — ชิปสีต่อใบเหมือนตาราง Periods
  // (แทนลิงก์ "สลิป" รวมวันเดิม). Query แยกจาก buildLedger() ตามช่วงวันที่ที่แสดง
  // จริง (scoped) เท่านั้น — ไม่แตะ buildLedger() (shared function หลายจุดใช้).
  if (scoped.length > 0) {
    const rangeFrom = scoped[0].date;
    const rangeTo = scoped[scoped.length - 1].date;
    const ledgerDeposits = await prisma.chairopsCashDeposit.findMany({
      where: {
        orgId,
        ...(branchId ? { branchId } : {}),
        depositedAt: {
          gte: new Date(`${rangeFrom}T00:00:00+07:00`),
          lt: new Date(new Date(`${rangeTo}T00:00:00+07:00`).getTime() + DAY_MS),
        },
      },
      select: {
        id: true,
        depositedAt: true,
        depositedAmount: true,
        ocrAmount: true,
        slipPhotoUrl: true,
        requiresReview: true,
      },
      orderBy: { depositedAt: "asc" },
    });
    const ledgerStatusById = await getLedgerStatusMap(orgId, ledgerDeposits.map((d) => d.id));
    const slipsByDate = new Map<string, PeriodSlip[]>();
    for (const d of ledgerDeposits) {
      const day = isoDay(d.depositedAt);
      const list = slipsByDate.get(day) ?? [];
      list.push({
        id: d.id,
        depositedAt: formatDateTime(d.depositedAt),
        amount: d.ocrAmount ?? d.depositedAmount,
        amountIsOcr: d.ocrAmount != null,
        slipUrl: d.slipPhotoUrl ?? null,
        ledgerStatus: ledgerStatusById.get(d.id) ?? "not_sent",
        flagged: d.requiresReview,
      });
      slipsByDate.set(day, list);
    }
    for (const d of scoped) {
      d.slips = slipsByDate.get(d.date) ?? [];
    }
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
// CEO 2026-08-15/17: สถานะส่งเข้าบัญชี reconcile ต่อใบฝาก (ledger_revenue_entry) —
// ดู lib/chairops/reconcile/ledger-push.ts. "sent_matched" = จับคู่กับ statement
// ธนาคารจริงแล้ว (โชว์สีรุ้งเหมือนหน้า LedgerLine bank-recon). ใช้ร่วมกันทั้งหน้า
// day-detail และตาราง Periods — ledger_revenue_entry.match_state คือ source of
// truth เดียว กันข้อมูล 2 ที่ไม่ตรงกัน.
export type LedgerStatus = "not_sent" | "sent_unmatched" | "sent_matched";

/** สถานะ reconcile ของหลายใบฝากพร้อมกัน — query เดียว ไม่ N+1 */
async function getLedgerStatusMap(
  orgId: string,
  depositIds: string[],
): Promise<Map<string, LedgerStatus>> {
  if (depositIds.length === 0) return new Map();
  const sourceRefs = depositIds.map((id) => `chairops-deposit-${id}`);
  const rows = await prisma.$queryRaw<{ source_ref: string; match_state: string }[]>`
    SELECT source_ref, match_state FROM ledger_revenue_entry
    WHERE org_id = ${orgId}::uuid AND source_type = 'CHAIROPS'
      AND source_ref = ANY(${sourceRefs})`;
  const byRef = new Map(rows.map((r) => [r.source_ref, r.match_state]));
  const out = new Map<string, LedgerStatus>();
  for (const id of depositIds) {
    const state = byRef.get(`chairops-deposit-${id}`);
    out.set(id, state == null ? "not_sent" : state === "matched" ? "sent_matched" : "sent_unmatched");
  }
  return out;
}

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
  // CEO 2026-06-29: who pressed ฝาก (role snapshot) → split แม่บ้านฝาก vs ออฟฟิศฝาก.
  depositedByRole: string | null;
  depositorKind: "maid" | "office" | "unknown";
  ledgerStatus: LedgerStatus;
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
      where: { orgId, ...branchFilter, collectedAt: { gte: start, lt: end }, deletedAt: null },
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
        depositedByRole: true,
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

  const ledgerStatusById = await getLedgerStatusMap(orgId, deposits.map((d) => d.id));

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
    depositedByRole: d.depositedByRole ?? null,
    depositorKind: depositActorKind(d.depositedByRole),
    ledgerStatus: ledgerStatusById.get(d.id) ?? "not_sent",
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
      where: { orgId, branchId, collectedAt: { gte: collStart, lt: collEnd }, deletedAt: null },
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

// ----------------------------------------------------------------
// PER-CHAIR DETAIL — long per-DAY × per-chair matrix (CEO 2026-06-29).
// Same money formula as getReconcilePerChair, but split BY DAY instead of summed
// over the window, plus a per-day disclosure strip: เก็บแยกที่มา (มือ/CSV/ออฟฟิศ),
// ฝากแยกผู้ฝาก (แม่บ้าน/ออฟฟิศ via depositedByRole), ตัดเงินขาด/เกิน.
// "สะสม" (cumVariance) is per-chair, running WITHIN the rendered window.
// Per-chair collected only exists for MAID_MANUAL chairBreakdown — CSV/legacy rows
// have no per-chair split, so on CSV-heavy days the chairs read ⚪ "ยังไม่เก็บรายตู้"
// and the money is disclosed in summary.unattributedCollected. NOT misleading-by-
// omission: the day's full collected total is always summary's source split.
// ----------------------------------------------------------------
const PER_CHAIR_DETAIL_MAX_DAYS = 92;

/** แม่บ้าน (MAID/TECHNICIAN) vs ออฟฟิศ/แอดมิน (OFFICE+) bucket for a deposit actor. */
export function depositActorKind(
  role: string | null | undefined,
): "maid" | "office" | "unknown" {
  if (!role) return "unknown";
  return role === "MAID" || role === "TECHNICIAN" ? "maid" : "office";
}

export interface PerChairDetailCell {
  chairCode: string;
  generation: string | null;
  expected: number; // POS cash + coin baht for THIS chair on THIS day (ควรได้)
  collected: number; // total counted for this chair this day (all sources)
  // CEO 2026-07-01 · split เก็บได้ per chair by WHO collected → the office can see
  // where each machine's money came from (before it was one lumped number = "งง").
  collectedBySource: {
    maidManual: number; // 💵 แม่บ้านเก็บมือ (chairBreakdown จากแอปแม่บ้าน)
    officeProxy: number; // 🏢 แอดมิน/ออฟฟิศเก็บแทน
    csvImport: number; // 📥 นำเข้า CSV (ปกติไม่มีแยกตู้ → มักเป็น 0 ที่นี่)
  };
  variance: number; // collected − expected (วันนั้น)
  cumVariance: number; // running Σ variance for this chair within the window (สะสม)
  hasPos: boolean;
  hasCollection: boolean; // a per-chair count exists this day (else ⚪ ยังไม่เก็บรายตู้)
  broken: boolean; // any chairBreakdown line ≠ "collected" this day
}
export interface PerChairDaySummary {
  collectedMaidManual: number; // 💵 แม่บ้านเก็บมือ
  collectedCsvImport: number; // 📥 เก็บผ่าน CSV
  collectedOfficeProxy: number; // 🏢 ออฟฟิศ/แอดมินเก็บแทน
  /** collections with no per-chair breakdown (CSV/legacy) — money present, no chair. */
  unattributedCollected: number;
  depositMaid: number; // 🏦 ฝากโดยแม่บ้าน
  depositOffice: number; // 🏦 ฝากโดยแอดมิน/ออฟฟิศ
  depositUnknown: number; // ฝาก role ยังไม่ระบุ (แถวเก่าที่ยังไม่ backfill)
  depositFee: number; // ค่าธรรมเนียมธนาคารวันนั้น
  writeOffShort: number; // ✂️ ตัดเงินขาด (direction SHORT) มีผลวันนั้น
  writeOffOver: number; // ✂️ ตัดเงินเกิน (direction OVER)
}
export interface PerChairDay {
  date: string; // YYYY-MM-DD
  chairs: PerChairDetailCell[];
  summary: PerChairDaySummary;
  expectedTotal: number; // Σ chairs.expected + POS-no-chairCode
  collectedTotal: number; // Σ chairs.collected + unattributedCollected
  varianceTotal: number;
  depositTotal: number; // Σ deposited amount that day (all actors)
}
export interface ReconcilePerChairDetail {
  from: string;
  to: string;
  days: PerChairDay[]; // newest-first
  truncated: boolean; // window clamped to maxDays
  maxDays: number;
  chairCount: number;
}

export async function getReconcilePerChairDetail(args: {
  orgId: string;
  branchId: string;
  from?: string;
  to?: string;
  allTime?: boolean;
  posCoverThrough?: string | null;
}): Promise<ReconcilePerChairDetail> {
  const { orgId, branchId } = args;

  // Resolve the [fromDay, toDay] window — SAME default as getReconcilePerChair.
  let fromDay: string;
  let toDay: string;
  if (args.allTime) {
    fromDay = "1970-01-01";
    toDay = isoDay(new Date());
  } else if (args.from || args.to) {
    fromDay = args.from ?? "1970-01-01";
    toDay = args.to ?? isoDay(new Date());
  } else {
    const anchor = args.posCoverThrough ?? isoDay(new Date());
    fromDay = isoMinusDaysLocal(anchor, 29);
    toDay = isoDay(new Date());
  }

  // The per-day × per-chair matrix is large → clamp the RENDERED window to the
  // most-recent maxDays. Cumulative starts at 0 at the window start (สะสมในช่วง).
  let truncated = false;
  if (daysBetween(fromDay, toDay) + 1 > PER_CHAIR_DETAIL_MAX_DAYS) {
    fromDay = isoMinusDaysLocal(toDay, PER_CHAIR_DETAIL_MAX_DAYS - 1);
    truncated = true;
  }

  const bizStart = new Date(fromDay);
  const bizEnd = new Date(toDay);
  const collStart = new Date(fromDay + "T00:00:00+07:00");
  const collEnd = new Date(new Date(toDay + "T00:00:00+07:00").getTime() + DAY_MS);

  const [chairs, posRows, collections, deposits, writeOffsRaw] =
    await Promise.all([
      prisma.chairopsChair.findMany({
        where: { orgId, branchId, isActive: true },
        select: { chairCode: true, generation: true },
      }),
      prisma.chairopsPosDaily.findMany({
        where: { orgId, branchId, bizDate: { gte: bizStart, lte: bizEnd } },
        select: {
          chairCode: true,
          cashTotal: true,
          coinInsertCount: true,
          bizDate: true,
        },
      }),
      prisma.chairopsCashCollection.findMany({
        where: { orgId, branchId, collectedAt: { gte: collStart, lt: collEnd }, deletedAt: null },
        select: {
          countedAmount: true,
          chairBreakdown: true,
          source: true,
          collectedAt: true,
        },
      }),
      prisma.chairopsCashDeposit.findMany({
        where: { orgId, branchId, depositedAt: { gte: collStart, lt: collEnd } },
        select: {
          depositedAmount: true,
          bankFee: true,
          depositedByRole: true,
          depositedAt: true,
        },
      }),
      prisma.chairopsWriteOff.findMany({
        where: { orgId, branchId, status: { in: ["PENDING", "APPROVED"] } },
        select: {
          amount: true,
          direction: true,
          effectiveDate: true,
          makerAt: true,
        },
      }),
    ]);

  const genByCode = new Map(chairs.map((c) => [c.chairCode, c.generation]));

  type CollSrc = { maidManual: number; officeProxy: number; csvImport: number };
  type DayBucket = {
    expByChair: Map<string, number>;
    collByChair: Map<string, CollSrc>;
    brokenByChair: Set<string>;
    unattributedExpected: number;
    summary: PerChairDaySummary;
    depositTotal: number;
  };
  const newSummary = (): PerChairDaySummary => ({
    collectedMaidManual: 0,
    collectedCsvImport: 0,
    collectedOfficeProxy: 0,
    unattributedCollected: 0,
    depositMaid: 0,
    depositOffice: 0,
    depositUnknown: 0,
    depositFee: 0,
    writeOffShort: 0,
    writeOffOver: 0,
  });
  const byDay = new Map<string, DayBucket>();
  const ensureDay = (day: string): DayBucket => {
    let b = byDay.get(day);
    if (!b) {
      b = {
        expByChair: new Map(),
        collByChair: new Map(),
        brokenByChair: new Set(),
        unattributedExpected: 0,
        summary: newSummary(),
        depositTotal: 0,
      };
      byDay.set(day, b);
    }
    return b;
  };

  // POS per chair per day (expected = same cash formula as the ledger).
  for (const p of posRows) {
    const b = ensureDay(isoDay(p.bizDate));
    const exp = toNum(p.cashTotal) + coinBahtOf(p.coinInsertCount);
    if (!p.chairCode) {
      b.unattributedExpected += exp;
      continue;
    }
    b.expByChair.set(p.chairCode, (b.expByChair.get(p.chairCode) ?? 0) + exp);
  }

  // Collections per day → per-chair collected (chairBreakdown) + source split.
  for (const c of collections) {
    const b = ensureDay(isoDay(c.collectedAt));
    const source = (c.source ?? "MAID_MANUAL") as LedgerDaySource;
    if (source === "CSV_IMPORT") b.summary.collectedCsvImport += c.countedAmount;
    else if (source === "OFFICE_PROXY")
      b.summary.collectedOfficeProxy += c.countedAmount;
    else b.summary.collectedMaidManual += c.countedAmount;

    const bd = c.chairBreakdown as { lines?: unknown } | null;
    const lines =
      bd && Array.isArray(bd.lines)
        ? (bd.lines as Array<Record<string, unknown>>)
        : null;
    if (!lines || lines.length === 0) {
      b.summary.unattributedCollected += c.countedAmount;
      continue;
    }
    for (const ln of lines) {
      const code = typeof ln.chairCode === "string" ? ln.chairCode.trim() : "";
      const amt = typeof ln.amount === "number" ? ln.amount : 0;
      if (!code) {
        if (amt > 0) b.summary.unattributedCollected += amt;
        continue;
      }
      const cur =
        b.collByChair.get(code) ?? { maidManual: 0, officeProxy: 0, csvImport: 0 };
      if (source === "CSV_IMPORT") cur.csvImport += amt;
      else if (source === "OFFICE_PROXY") cur.officeProxy += amt;
      else cur.maidManual += amt;
      b.collByChair.set(code, cur);
      const status = typeof ln.status === "string" ? ln.status : "";
      if (status && status !== "collected") b.brokenByChair.add(code);
    }
  }

  // Deposits per day → split by actor role (maidId = the actor; role = snapshot).
  for (const d of deposits) {
    const b = ensureDay(isoDay(d.depositedAt));
    const kind = depositActorKind(d.depositedByRole);
    if (kind === "maid") b.summary.depositMaid += d.depositedAmount;
    else if (kind === "office") b.summary.depositOffice += d.depositedAmount;
    else b.summary.depositUnknown += d.depositedAmount;
    b.summary.depositFee += d.bankFee;
    b.depositTotal += d.depositedAmount;
  }

  // Write-offs by effective day (SAME bucket as the ledger ✂️ marker).
  for (const w of writeOffsRaw) {
    const day = isoDay(w.effectiveDate ?? w.makerAt);
    if (day < fromDay || day > toDay) continue;
    const b = ensureDay(day);
    if (w.direction === "OVER") b.summary.writeOffOver += w.amount;
    else b.summary.writeOffShort += w.amount;
  }

  // Ascending pass for the running cumulative, then reverse for newest-first display.
  const dayKeys = [...byDay.keys()].sort();
  const cumByChair = new Map<string, number>();
  const daysAsc: PerChairDay[] = dayKeys.map((day) => {
    const b = byDay.get(day)!;
    const codes = new Set<string>([
      ...b.expByChair.keys(),
      ...b.collByChair.keys(),
    ]);
    const cells: PerChairDetailCell[] = [...codes].map((code) => {
      const expected = Math.round(b.expByChair.get(code) ?? 0);
      const cs = b.collByChair.get(code);
      const collectedBySource = {
        maidManual: Math.round(cs?.maidManual ?? 0),
        officeProxy: Math.round(cs?.officeProxy ?? 0),
        csvImport: Math.round(cs?.csvImport ?? 0),
      };
      const collected =
        collectedBySource.maidManual +
        collectedBySource.officeProxy +
        collectedBySource.csvImport;
      const variance = collected - expected;
      const cumVariance = (cumByChair.get(code) ?? 0) + variance;
      cumByChair.set(code, cumVariance);
      return {
        chairCode: code,
        generation: genByCode.get(code) ?? null,
        expected,
        collected,
        collectedBySource,
        variance,
        cumVariance,
        hasPos: b.expByChair.has(code),
        hasCollection: b.collByChair.has(code),
        broken: b.brokenByChair.has(code),
      };
    });
    // Chairs WITH a per-chair count first (real signal), worst shortage first.
    cells.sort(
      (a, c) =>
        (a.hasCollection === c.hasCollection ? 0 : a.hasCollection ? -1 : 1) ||
        a.variance - c.variance ||
        a.chairCode.localeCompare(c.chairCode),
    );
    const expectedTotal = Math.round(
      cells.reduce((s, x) => s + x.expected, 0) + b.unattributedExpected,
    );
    const collectedTotal =
      cells.reduce((s, x) => s + x.collected, 0) +
      Math.round(b.summary.unattributedCollected);
    return {
      date: day,
      chairs: cells,
      summary: b.summary,
      expectedTotal,
      collectedTotal,
      varianceTotal: collectedTotal - expectedTotal,
      depositTotal: b.depositTotal,
    };
  });

  return {
    from: fromDay,
    to: toDay,
    days: daysAsc.reverse(),
    truncated,
    maxDays: PER_CHAIR_DETAIL_MAX_DAYS,
    chairCount: chairs.length,
  };
}

// ----------------------------------------------------------------
// 2c) PER-CHAIR · TIME-WINDOWED (meter-delta) — expected = sales accrued in the
//     machine UP TO the maid's collection time, from the cumulative meter
//     odometer (ChairopsPosCashEvent.cashMeter + ChairopsPosCoinEvent.coinMeter
//     ×10) — NOT the whole-day PosDaily total. Fixes the false-shortage when a
//     maid collects midday but the machine keeps selling all evening, and lets
//     us verify each ROUND. The maid-entered collection time is the window
//     boundary; the meter is the ungameable amount (gaming the time only
//     shuffles a shortage to the next round — cumulative stays exact since
//     window-end of round N = window-start of round N+1). Read-only; does NOT
//     touch the ledger/drift. See
//     [[chairops-time-based-collection-verification-design-2026-06-29]].
// ----------------------------------------------------------------
export type PerChairVerdict =
  | "ok" // 🟢 ตรง (within tolerance)
  | "warn" // 🟡 ขาดเล็กน้อย
  | "short" // 🔴 ขาดเยอะ ต้องตรวจ
  | "over" // 🟡 เก็บเกินยอดขาย (ผิดปกติ)
  | "incomplete" // ⚪ ไม่มีข้อมูล event / มิเตอร์ผิดปกติ
  | "uncollected"; // ⚪ ยังไม่เก็บรอบนี้ (มีแต่ยอดขาย)

export interface PerChairRoundTW {
  collectedAt: string; // ISO instant the maid says she collected
  collected: number; // เก็บได้ รอบนี้ (this chair's amount)
  expected: number | null; // ควรได้ ถึงเวลานั้น (meterΔ prevRound→thisRound) · null = ⚪
  variance: number | null; // collected − expected (− = ขาด)
  verdict: PerChairVerdict;
  broken: boolean; // chairBreakdown line status ≠ "collected"
}

export interface PerChairRowTW {
  chairCode: string;
  generation: string | null;
  // latest collection round IN the selected window
  lastCollectedAt: string | null;
  lastCollected: number | null; // เก็บได้ (รอบล่าสุด)
  lastExpected: number | null; // ควรได้ ถึงเวลานั้น
  lastVariance: number | null; // เก็บได้ − ควรได้
  verdict: PerChairVerdict;
  // standing (all-time, ungameable)
  cumShortage: number | null; // ขาดสะสม (− = ขาด · + = เก็บเกิน) · null = ⚪
  inBoxNow: number | null; // รอเก็บในกล่องตอนนี้ = ยอดขายหลังเก็บรอบล่าสุด (ยังไม่เก็บ)
  hasEvents: boolean;
}

export interface ReconcilePerChairTW {
  from: string;
  to: string;
  rows: PerChairRowTW[];
  totals: {
    lastCollected: number;
    lastExpected: number;
    lastVariance: number;
    verifiedCount: number;
    incompleteCount: number;
    uncollectedCount: number;
  };
  cumShortageTotal: number; // Σ per-machine ขาดสะสม (ตัวจับโกงจริง)
  inBoxNowTotal: number; // Σ เงินที่คาดว่ายังอยู่ในเครื่องตอนนี้
}

/** Cumulative-meter value (cash baht or coin count) as of instant `at` =
 *  the last event with eventAt ≤ at for that device. null when no event ≤ at
 *  (NEVER treat as 0 — that would fabricate a shortage; the caller maps to ⚪). */
function meterAsOf(
  series: { t: number; m: number }[] | undefined,
  at: number,
): number | null {
  if (!series || series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= at) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? series[ans].m : null;
}

/** Verdict from a (collected − expected) variance against a tolerance band that
 *  floors at ฿20 and widens with the expected amount (rounding + the natural
 *  slack of a 30–60 min collection walk). */
function perChairVerdict(variance: number, expected: number): PerChairVerdict {
  const tol = Math.max(20, Math.abs(expected) * 0.02);
  if (Math.abs(variance) <= tol) return "ok";
  if (variance > 0) return "over";
  const big = Math.abs(variance) > 100 || Math.abs(variance) > Math.abs(expected) * 0.05;
  return big ? "short" : "warn";
}

/** Read this branch's cash+coin events (eventAt ≤ now, from `sinceMs`) into
 *  per-device cumulative-meter series for binary-search "meter as of T".
 *  Coin meter (BigInt count) → Number (counts are well within 2^53). */
async function loadMeterSeries(args: {
  orgId: string;
  branchId: string;
  sinceMs: number;
}): Promise<{
  cash: Map<string, { t: number; m: number }[]>;
  coin: Map<string, { t: number; m: number }[]>;
  anyEvents: boolean;
  latestCashByDev: Map<string, number>;
  latestCoinByDev: Map<string, number>;
}> {
  const since = new Date(Math.max(0, args.sinceMs));
  const now = new Date();
  const [cashEv, coinEv] = await Promise.all([
    prisma.chairopsPosCashEvent.findMany({
      where: { orgId: args.orgId, branchId: args.branchId, eventAt: { gte: since, lte: now } },
      select: { chairDeviceId: true, eventAt: true, cashMeter: true },
      orderBy: { eventAt: "asc" },
    }),
    prisma.chairopsPosCoinEvent.findMany({
      where: { orgId: args.orgId, branchId: args.branchId, eventAt: { gte: since, lte: now } },
      select: { chairDeviceId: true, eventAt: true, coinMeter: true },
      orderBy: { eventAt: "asc" },
    }),
  ]);
  const cash = new Map<string, { t: number; m: number }[]>();
  const latestCashByDev = new Map<string, number>();
  for (const e of cashEv) {
    const arr = cash.get(e.chairDeviceId) ?? [];
    const m = toNum(e.cashMeter);
    arr.push({ t: e.eventAt.getTime(), m });
    cash.set(e.chairDeviceId, arr);
    latestCashByDev.set(e.chairDeviceId, m);
  }
  const coin = new Map<string, { t: number; m: number }[]>();
  const latestCoinByDev = new Map<string, number>();
  for (const e of coinEv) {
    const arr = coin.get(e.chairDeviceId) ?? [];
    const m = Number(e.coinMeter);
    arr.push({ t: e.eventAt.getTime(), m });
    coin.set(e.chairDeviceId, arr);
    latestCoinByDev.set(e.chairDeviceId, m);
  }
  return {
    cash,
    coin,
    anyEvents: cashEv.length > 0 || coinEv.length > 0,
    latestCashByDev,
    latestCoinByDev,
  };
}

export async function getReconcilePerChairTW(args: {
  orgId: string;
  branchId: string;
  from?: string;
  to?: string;
  allTime?: boolean;
  posCoverThrough?: string | null;
}): Promise<ReconcilePerChairTW> {
  const { orgId, branchId } = args;

  let fromDay: string;
  let toDay: string;
  if (args.allTime) {
    fromDay = "1970-01-01";
    toDay = isoDay(new Date());
  } else if (args.from || args.to) {
    fromDay = args.from ?? "1970-01-01";
    toDay = args.to ?? isoDay(new Date());
  } else {
    const anchor = args.posCoverThrough ?? isoDay(new Date());
    fromDay = isoMinusDaysLocal(anchor, 29);
    toDay = isoDay(new Date());
  }
  const collStart = new Date(fromDay + "T00:00:00+07:00").getTime();
  const collEnd = new Date(toDay + "T00:00:00+07:00").getTime() + DAY_MS;

  const [chairs, collections] = await Promise.all([
    prisma.chairopsChair.findMany({
      where: { orgId, branchId, isActive: true },
      select: { chairCode: true, generation: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: { orgId, branchId, deletedAt: null },
      select: { collectedAt: true, chairBreakdown: true },
      orderBy: { collectedAt: "asc" },
    }),
  ]);

  type Round = { t: number; amount: number; broken: boolean };
  const roundsByChair = new Map<string, Round[]>();
  for (const c of collections) {
    const bd = c.chairBreakdown as { lines?: unknown } | null;
    const lines = bd && Array.isArray(bd.lines) ? (bd.lines as Array<Record<string, unknown>>) : null;
    if (!lines) continue;
    const t = c.collectedAt.getTime();
    for (const ln of lines) {
      const code = typeof ln.chairCode === "string" ? ln.chairCode.trim() : "";
      if (!code) continue;
      const amount = typeof ln.amount === "number" ? ln.amount : 0;
      const status = typeof ln.status === "string" ? ln.status : "";
      const arr = roundsByChair.get(code) ?? [];
      arr.push({ t, amount, broken: status !== "" && status !== "collected" });
      roundsByChair.set(code, arr);
    }
  }

  let earliestNeeded = collStart - 45 * DAY_MS;
  for (const rounds of roundsByChair.values()) {
    rounds.sort((a, b) => a.t - b.t);
    const firstInWin = rounds.find((r) => r.t >= collStart && r.t < collEnd);
    if (!firstInWin) continue;
    const prior = [...rounds].reverse().find((r) => r.t < firstInWin.t);
    if (prior) earliestNeeded = Math.min(earliestNeeded, prior.t - 2 * DAY_MS);
  }

  const { cash, coin, latestCashByDev, latestCoinByDev } = await loadMeterSeries({
    orgId,
    branchId,
    sinceMs: earliestNeeded,
  });

  const genByCode = new Map(chairs.map((c) => [c.chairCode, c.generation]));
  const allCodes = new Set<string>([...chairs.map((c) => c.chairCode), ...roundsByChair.keys()]);

  const rows: PerChairRowTW[] = [];
  let tLastCollected = 0;
  let tLastExpected = 0;
  let tLastVariance = 0;
  let verifiedCount = 0;
  let incompleteCount = 0;
  let uncollectedCount = 0;
  let cumShortageTotal = 0;
  let inBoxNowTotal = 0;

  for (const code of allCodes) {
    const rounds = (roundsByChair.get(code) ?? []).slice().sort((a, b) => a.t - b.t);
    const cashSeries = cash.get(code);
    const coinSeries = coin.get(code);
    const hasEvents = (cashSeries?.length ?? 0) > 0 || (coinSeries?.length ?? 0) > 0;

    const inWin = rounds.filter((r) => r.t >= collStart && r.t < collEnd);
    let lastCollectedAt: string | null = null;
    let lastCollected: number | null = null;
    let lastExpected: number | null = null;
    let lastVariance: number | null = null;
    let verdict: PerChairVerdict;

    if (inWin.length === 0) {
      verdict = "uncollected";
      uncollectedCount += 1;
    } else {
      const last = inWin[inWin.length - 1];
      lastCollectedAt = new Date(last.t).toISOString();
      lastCollected = Math.round(last.amount);
      const prior = [...rounds].reverse().find((r) => r.t < last.t) ?? null;
      const cashUp = meterAsOf(cashSeries, last.t);
      const coinUp = meterAsOf(coinSeries, last.t);
      if (cashUp === null && coinUp === null) {
        verdict = "incomplete";
        incompleteCount += 1;
      } else {
        const cashLo = prior ? meterAsOf(cashSeries, prior.t) : 0;
        const coinLo = prior ? meterAsOf(coinSeries, prior.t) : 0;
        if (prior && cashLo === null && coinLo === null) {
          verdict = "incomplete";
          incompleteCount += 1;
        } else {
          const cashDelta = (cashUp ?? cashLo ?? 0) - (cashLo ?? 0);
          const coinDelta = (coinUp ?? coinLo ?? 0) - (coinLo ?? 0);
          if (cashDelta < 0 || coinDelta < 0) {
            verdict = "incomplete";
            incompleteCount += 1;
          } else {
            const exp = Math.round(cashDelta + coinBahtOf(coinDelta));
            lastExpected = exp;
            lastVariance = lastCollected - exp;
            verdict = perChairVerdict(lastVariance, exp);
            tLastCollected += lastCollected;
            tLastExpected += exp;
            tLastVariance += lastVariance;
            verifiedCount += 1;
          }
        }
      }
    }

    // Cumulative shortage = Σ per-round (collected − meter delta) for rounds
    // 2..N, computed round-by-round (NOT endpoint-only). meterAsOf() is a
    // lifetime odometer, so we compare each round's collection against the meter
    // DELTA since the previous round (comparing collected-so-far vs the raw
    // odometer previously showed a fake six-figure shortage). Round 1 is
    // excluded (no prior baseline). If any round in the span has a meter RESET
    // (delta < 0 → unknowable) or lacks a usable baseline, the whole figure is
    // null — never a silently mis-stated number that could hide a real shortage.
    let cumShortage: number | null = null;
    const lastEver = rounds.length ? rounds[rounds.length - 1] : null;
    if (rounds.length >= 2) {
      let sum = 0;
      let ok = true;
      for (let i = 1; i < rounds.length; i++) {
        const cashLo = meterAsOf(cashSeries, rounds[i - 1].t);
        const coinLo = meterAsOf(coinSeries, rounds[i - 1].t);
        const cashHi = meterAsOf(cashSeries, rounds[i].t);
        const coinHi = meterAsOf(coinSeries, rounds[i].t);
        let cashDelta = 0;
        let coinDelta = 0;
        let anyStream = false;
        // Require the SAME stream present at BOTH ends before trusting its delta
        // (a stream present at only one endpoint would fabricate a bogus delta).
        if (cashLo !== null && cashHi !== null) { cashDelta = cashHi - cashLo; anyStream = true; }
        if (coinLo !== null && coinHi !== null) { coinDelta = coinHi - coinLo; anyStream = true; }
        if (!anyStream) { ok = false; break; }
        if (cashDelta < 0 || coinDelta < 0) { ok = false; break; } // reset → unknowable
        const exp = Math.round(cashDelta + coinBahtOf(coinDelta));
        sum += Math.round(rounds[i].amount) - exp;
      }
      if (ok) {
        cumShortage = sum;
        cumShortageTotal += cumShortage;
      }
    }

    let inBoxNow: number | null = null;
    if (hasEvents && lastEver) {
      const cashNow = latestCashByDev.get(code) ?? null;
      const coinNow = latestCoinByDev.get(code) ?? null;
      const cashAtColl = meterAsOf(cashSeries, lastEver.t);
      const coinAtColl = meterAsOf(coinSeries, lastEver.t);
      if (cashNow !== null || coinNow !== null) {
        const d =
          (cashNow ?? cashAtColl ?? 0) - (cashAtColl ?? 0) +
          coinBahtOf((coinNow ?? coinAtColl ?? 0) - (coinAtColl ?? 0));
        inBoxNow = Math.max(0, Math.round(d));
        inBoxNowTotal += inBoxNow;
      }
    }

    rows.push({
      chairCode: code,
      generation: genByCode.get(code) ?? null,
      lastCollectedAt,
      lastCollected,
      lastExpected,
      lastVariance,
      verdict,
      cumShortage,
      inBoxNow,
      hasEvents,
    });
  }

  rows.sort(
    (a, b) =>
      (a.lastVariance ?? 0) - (b.lastVariance ?? 0) ||
      (a.cumShortage ?? 0) - (b.cumShortage ?? 0) ||
      a.chairCode.localeCompare(b.chairCode),
  );

  return {
    from: fromDay,
    to: toDay,
    rows,
    totals: {
      lastCollected: tLastCollected,
      lastExpected: tLastExpected,
      lastVariance: tLastVariance,
      verifiedCount,
      incompleteCount,
      uncollectedCount,
    },
    cumShortageTotal: Math.round(cumShortageTotal),
    inBoxNowTotal: Math.round(inBoxNowTotal),
  };
}

/** Drill: every collection round for one chair (newest first) with the
 *  time-windowed expected per round. Powers the per-machine history panel. */
export async function getReconcilePerChairRoundsTW(args: {
  orgId: string;
  branchId: string;
  chairCode: string;
}): Promise<{ chairCode: string; rounds: PerChairRoundTW[]; cumShortage: number | null }> {
  const { orgId, branchId, chairCode } = args;
  const collections = await prisma.chairopsCashCollection.findMany({
    where: { orgId, branchId, deletedAt: null },
    select: { collectedAt: true, chairBreakdown: true },
    orderBy: { collectedAt: "asc" },
  });
  const rounds: { t: number; amount: number; broken: boolean }[] = [];
  for (const c of collections) {
    const bd = c.chairBreakdown as { lines?: unknown } | null;
    const lines = bd && Array.isArray(bd.lines) ? (bd.lines as Array<Record<string, unknown>>) : null;
    if (!lines) continue;
    for (const ln of lines) {
      const code = typeof ln.chairCode === "string" ? ln.chairCode.trim() : "";
      if (code !== chairCode) continue;
      const amount = typeof ln.amount === "number" ? ln.amount : 0;
      const status = typeof ln.status === "string" ? ln.status : "";
      rounds.push({ t: c.collectedAt.getTime(), amount, broken: status !== "" && status !== "collected" });
    }
  }
  rounds.sort((a, b) => a.t - b.t);
  if (rounds.length === 0) return { chairCode, rounds: [], cumShortage: null };

  const { cash, coin } = await loadMeterSeries({ orgId, branchId, sinceMs: rounds[0].t - 2 * DAY_MS });
  const cashSeries = cash.get(chairCode);
  const coinSeries = coin.get(chairCode);

  const out: PerChairRoundTW[] = [];
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const prior = i > 0 ? rounds[i - 1] : null;
    const cashUp = meterAsOf(cashSeries, r.t);
    const coinUp = meterAsOf(coinSeries, r.t);
    let expected: number | null = null;
    let variance: number | null = null;
    let verdict: PerChairVerdict;
    if (cashUp === null && coinUp === null) {
      verdict = "incomplete";
    } else {
      const cashLo = prior ? meterAsOf(cashSeries, prior.t) : 0;
      const coinLo = prior ? meterAsOf(coinSeries, prior.t) : 0;
      if (prior && cashLo === null && coinLo === null) {
        verdict = "incomplete";
      } else {
        const cashDelta = (cashUp ?? cashLo ?? 0) - (cashLo ?? 0);
        const coinDelta = (coinUp ?? coinLo ?? 0) - (coinLo ?? 0);
        if (cashDelta < 0 || coinDelta < 0) {
          verdict = "incomplete";
        } else {
          expected = Math.round(cashDelta + coinBahtOf(coinDelta));
          variance = Math.round(r.amount) - expected;
          verdict = perChairVerdict(variance, expected);
        }
      }
    }
    out.push({
      collectedAt: new Date(r.t).toISOString(),
      collected: Math.round(r.amount),
      expected,
      variance,
      verdict,
      broken: r.broken,
    });
  }
  out.reverse();

  // Cumulative shortage = collected from the 2nd round onward minus the meter
  // DELTA across that span. meterAsOf() is a lifetime odometer, so subtract the
  // first-round baseline (comparing collected-so-far vs the raw odometer showed
  // a fake six-figure shortage). The first round's pre-tracking take is
  // unknowable → a single round yields null.
  const firstEver = rounds[0];
  const lastEver = rounds[rounds.length - 1];
  let cumShortage: number | null = null;
  if (lastEver.t > firstEver.t) {
    const cashHi = meterAsOf(cashSeries, lastEver.t);
    const coinHi = meterAsOf(coinSeries, lastEver.t);
    const cashBase = meterAsOf(cashSeries, firstEver.t);
    const coinBase = meterAsOf(coinSeries, firstEver.t);
    if (
      (cashHi !== null || coinHi !== null) &&
      (cashBase !== null || coinBase !== null)
    ) {
      const expDelta =
        (cashHi ?? 0) - (cashBase ?? 0) +
        coinBahtOf((coinHi ?? 0) - (coinBase ?? 0));
      if (expDelta >= 0) {
        const collectedSinceBase = rounds
          .slice(1)
          .reduce((s, r) => s + r.amount, 0);
        cumShortage = Math.round(collectedSinceBase - expDelta);
      }
    }
  }

  return { chairCode, rounds: out, cumShortage };
}

// ----------------------------------------------------------------
// 2d) SHORTAGE TREND — "ยอดขาดสะสมโตต่อเนื่อง N รอบติด" (Wave 4 alert source).
//     Reuses the meter-delta per-round engine: a BRANCH trends short when its
//     last N collection events are each net short (Σ collected < Σ expected),
//     and a CHAIR trends short when its last N rounds are each short. Cumulative
//     meter = ungameable, so a sustained worsening = real leakage, not noise.
//     Read-only; consumed by the daily detector. CEO 2026-06-29: N=3.
// ----------------------------------------------------------------
function isShortVariance(variance: number, expected: number): boolean {
  return variance < -Math.max(20, Math.abs(expected) * 0.02);
}

export interface ShortageTrend {
  branchTrending: boolean;
  branchLast: { collectedAt: string; collected: number; expected: number; variance: number }[];
  chairsTrending: { chairCode: string; variances: number[] }[];
}

export async function getBranchShortageTrend(args: {
  orgId: string;
  branchId: string;
  consecutive?: number;
}): Promise<ShortageTrend> {
  const n = args.consecutive ?? 3;
  const { orgId, branchId } = args;
  const collections = await prisma.chairopsCashCollection.findMany({
    where: { orgId, branchId, deletedAt: null },
    select: { collectedAt: true, chairBreakdown: true },
    orderBy: { collectedAt: "asc" },
  });
  type R = { t: number; amount: number };
  const roundsByChair = new Map<string, R[]>();
  const eventTimes = new Set<number>();
  for (const c of collections) {
    const bd = c.chairBreakdown as { lines?: unknown } | null;
    const lines = bd && Array.isArray(bd.lines) ? (bd.lines as Array<Record<string, unknown>>) : null;
    if (!lines) continue;
    const t = c.collectedAt.getTime();
    eventTimes.add(t);
    for (const ln of lines) {
      const code = typeof ln.chairCode === "string" ? ln.chairCode.trim() : "";
      if (!code) continue;
      const amount = typeof ln.amount === "number" ? ln.amount : 0;
      const arr = roundsByChair.get(code) ?? [];
      arr.push({ t, amount });
      roundsByChair.set(code, arr);
    }
  }
  if (eventTimes.size < n) return { branchTrending: false, branchLast: [], chairsTrending: [] };

  const sortedEvents = [...eventTimes].sort((a, b) => a - b);
  const since = (sortedEvents[Math.max(0, sortedEvents.length - n - 1)] ?? sortedEvents[0]) - 2 * DAY_MS;
  const { cash, coin } = await loadMeterSeries({ orgId, branchId, sinceMs: since });

  const branchByEvent = new Map<number, { collected: number; expected: number }>();
  const chairsTrending: ShortageTrend["chairsTrending"] = [];

  for (const [code, rs] of roundsByChair) {
    rs.sort((a, b) => a.t - b.t);
    const cashS = cash.get(code);
    const coinS = coin.get(code);
    const perRound: { variance: number | null; expected: number | null }[] = [];
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      const prior = i > 0 ? rs[i - 1] : null;
      const cashUp = meterAsOf(cashS, r.t);
      const coinUp = meterAsOf(coinS, r.t);
      let expected: number | null = null;
      let variance: number | null = null;
      if (cashUp !== null || coinUp !== null) {
        const cashLo = prior ? meterAsOf(cashS, prior.t) : 0;
        const coinLo = prior ? meterAsOf(coinS, prior.t) : 0;
        if (!(prior && cashLo === null && coinLo === null)) {
          const cd = (cashUp ?? cashLo ?? 0) - (cashLo ?? 0);
          const kd = (coinUp ?? coinLo ?? 0) - (coinLo ?? 0);
          if (cd >= 0 && kd >= 0) {
            expected = Math.round(cd + coinBahtOf(kd));
            variance = Math.round(r.amount) - expected;
          }
        }
      }
      perRound.push({ variance, expected });
      if (expected !== null && variance !== null) {
        const e = branchByEvent.get(r.t) ?? { collected: 0, expected: 0 };
        e.collected += Math.round(r.amount);
        e.expected += expected;
        branchByEvent.set(r.t, e);
      }
    }
    const lastN = perRound.slice(-n);
    const chairTrend =
      lastN.length === n &&
      lastN.every((x) => x.variance !== null && x.expected !== null && isShortVariance(x.variance, x.expected));
    if (chairTrend) {
      chairsTrending.push({ chairCode: code, variances: lastN.map((x) => x.variance as number) });
    }
  }

  const evSorted = [...branchByEvent.entries()].sort((a, b) => a[0] - b[0]).slice(-n);
  const branchTrending =
    evSorted.length === n && evSorted.every(([, e]) => isShortVariance(e.collected - e.expected, e.expected));
  const branchLast = evSorted.map(([t, e]) => ({
    collectedAt: new Date(t).toISOString(),
    collected: e.collected,
    expected: e.expected,
    variance: e.collected - e.expected,
  }));
  return { branchTrending, branchLast, chairsTrending };
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
        slips: [],
        diff,
        cumBefore: lastDriftBefore,
        cumAfter: d.cumDrift,
        open: false,
        intent: Math.abs(diff) < 100 ? "ok" : "crit",
        expectedMeter: null,
        varianceMeter: null,
        verdictMeter: "uncollected",
        cumShortageMeter: null,
        meterWindowStart: null,
        meterWindowEnd: null,
        meterPending: false,
        meterLatest: null,
        depositDiff: null,
        depositDiffCum: null,
        collectedSum: 0,
        firstCollectedAt: null,
        lastCollectedAt: null,
        collectors: [],
        bySource: {
          maidManual: { count: 0, total: 0 },
          csvImport: { count: 0, total: 0 },
          officeProxy: { count: 0, total: 0 },
        },
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
      slips: [],
      diff: null,
      cumBefore: lastDriftBefore,
      cumAfter: lastDriftBefore,
      open: true,
      intent: "warn",
      expectedMeter: null,
      varianceMeter: null,
      verdictMeter: "uncollected",
      cumShortageMeter: null,
      meterWindowStart: null,
      meterWindowEnd: null,
      meterPending: false,
      meterLatest: null,
      depositDiff: null,
      depositDiffCum: null,
      collectedSum: 0,
      firstCollectedAt: null,
      lastCollectedAt: null,
      collectors: [],
      bySource: {
        maidManual: { count: 0, total: 0 },
        csvImport: { count: 0, total: 0 },
        officeProxy: { count: 0, total: 0 },
      },
    });
  }

  // CEO 2026-06-30 (Pinpoint #3) · enrich each period with the REAL collection
  // clock-times (เก็บครั้งก่อน→ครั้งนี้) and who collected (มือ/CSV/แอดมิน).
  // The money math above (posSum/cashSum/deposit/diff/cumDrift) is untouched —
  // this only ADDS display data, never changes the verified drift formula.
  const periodSince = startOfDayMinus(365);
  const periodCollections = await prisma.chairopsCashCollection.findMany({
    where: {
      orgId,
      ...(branchId ? { branchId } : {}),
      collectedAt: { gte: periodSince },
      deletedAt: null,
    },
    select: { collectedAt: true, source: true, countedAmount: true },
    orderBy: { collectedAt: "asc" },
  });
  // wins are contiguous + ascending here (before reverse). Linear find is fine
  // for the per-branch collection volume.
  // Raw collection instant (ms) per window = the boundary for time-windowed meter math.
  const winLastColMs: (number | null)[] = wins.map(() => null);
  const findWin = (day: string): number => {
    for (let k = 0; k < wins.length; k++) {
      if (day >= wins[k].from && day <= wins[k].to) return k;
    }
    return wins.length > 0 && day < wins[0].from ? 0 : -1;
  };
  for (const c of periodCollections) {
    const day = isoDay(c.collectedAt);
    const idx = findWin(day);
    if (idx < 0) continue;
    const w = wins[idx];
    const src = (c.source ?? "MAID_MANUAL") as LedgerDaySource;
    const bucket =
      src === "CSV_IMPORT"
        ? w.bySource.csvImport
        : src === "OFFICE_PROXY"
          ? w.bySource.officeProxy
          : w.bySource.maidManual;
    bucket.count += 1;
    bucket.total += c.countedAmount;
    w.collectedSum += c.countedAmount;
    if (!w.collectors.includes(src)) w.collectors.push(src);
    const ts = formatDateTime(c.collectedAt);
    if (w.firstCollectedAt == null) w.firstCollectedAt = ts; // asc → earliest first
    w.lastCollectedAt = ts; // asc → latest last
    winLastColMs[idx] = c.collectedAt.getTime(); // asc → latest instant in window
  }

  // CEO 2026-07-01 · TIME-WINDOWED anti-fraud per round (per branch only · meter-based).
  // For each round, "ควรได้ตามเวลา" = Σ machine meter delta in [prev collection
  // instant → this collection instant] = the sales the machines actually made in
  // the exact window the maid's round covers. Compare vs collectedSum (เก็บได้) →
  // catch skimming/rotation this round. Meter/DISPLAY-ONLY — never touches the
  // full-day cashSum/deposit/drift columns (those still power the deposit ledger).
  if (branchId && periodCollections.length > 0) {
    const earliest = periodCollections[0].collectedAt.getTime() - 2 * DAY_MS;
    const { cash, coin } = await loadMeterSeries({ orgId, branchId, sinceMs: earliest });
    const devices = new Set<string>([...cash.keys(), ...coin.keys()]);
    // CEO 2026-07-08 · meter data is batched and lags ~1 day. latestMeterMs = the
    // newest reading we actually have for this branch. A round whose collection (t1)
    // is more than a small buffer PAST latestMeterMs has no meter coverage through
    // the collection → its expected would be a misleadingly-low number → mark pending.
    const METER_PENDING_BUFFER_MS = 2 * 60 * 60 * 1000; // 2h absorbs normal report cadence
    let latestMeterMs = 0;
    for (const s of cash.values()) if (s.length) latestMeterMs = Math.max(latestMeterMs, s[s.length - 1].t);
    for (const s of coin.values()) if (s.length) latestMeterMs = Math.max(latestMeterMs, s[s.length - 1].t);
    // Σ machine meter delta over (t0, t1] · t0=null → cumulative from series start
    // (first round = onboarding backlog, mirrors getReconcilePerChairTW). null when
    // NO machine has meter data for the window (⚪ — never fabricate a shortage).
    const meterDelta = (t0: number | null, t1: number): number | null => {
      let sum = 0;
      let any = false;
      for (const code of devices) {
        const cs = cash.get(code);
        const co = coin.get(code);
        const cashUp = meterAsOf(cs, t1);
        const coinUp = meterAsOf(co, t1);
        if (cashUp === null && coinUp === null) continue; // device silent in window
        const cashLo = t0 !== null ? meterAsOf(cs, t0) : 0;
        const coinLo = t0 !== null ? meterAsOf(co, t0) : 0;
        const cd = (cashUp ?? cashLo ?? 0) - (cashLo ?? 0);
        const kd = (coinUp ?? coinLo ?? 0) - (coinLo ?? 0);
        if (cd < 0 || kd < 0) continue; // meter reset → skip device (don't corrupt Σ)
        sum += cd + coinBahtOf(kd);
        any = true;
      }
      // CEO 2026-07-07 · a round whose Σ meter delta is exactly 0 means the meter is
      // FROZEN — no new reading landed in this window (e.g. events orphaned to a NULL
      // branch by a duplicate-branch name clash), NOT a real zero-sales round. Return
      // null so the view falls back to full-day sales (⚪ "ไม่มีข้อมูลมิเตอร์") instead
      // of a misleading "ควรได้ 0". Safe: negative deltas are already skipped above, so
      // sum===0 ⟺ genuinely no metered movement (never hides a real shortage).
      const total = Math.round(sum);
      return any && total > 0 ? total : null;
    };
    const nowMs = Date.now();
    let cum = 0;
    let prevMs: number | null = null;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (w.open) {
        // pending tail — money sitting in machines since the last collection (informational).
        // Needs a prior-collection baseline; without one (prevMs===null · สาขาไม่เคยเก็บ)
        // meterDelta(null,now) = full lifetime odometer = garbage → show ⚪ not a giant number.
        w.expectedMeter = prevMs != null ? meterDelta(prevMs, nowMs) : null;
        w.varianceMeter = null;
        w.verdictMeter = "uncollected";
        w.cumShortageMeter = cum === 0 ? null : Math.round(cum);
        w.meterWindowStart = prevMs != null ? formatDateTime(new Date(prevMs)) : null;
        w.meterWindowEnd = formatDateTime(new Date(nowMs));
        continue;
      }
      const t1 = winLastColMs[i];
      if (t1 == null) {
        w.verdictMeter = "incomplete";
        continue;
      }
      // CEO 2026-07-08 · the meter data hasn't reached this collection yet (batched /
      // machine offline). expectedMeter here would be computed on stale readings →
      // fake shortage/surplus (e.g. ควรได้ 20 vs เก็บได้ 660). Flag pending → the view
      // shows "⚪ รอมิเตอร์ (อัปเดตถึง …)" and drops the variance. Rounds are ascending,
      // so once one is pending every newer round is too.
      if (latestMeterMs > 0 && t1 - latestMeterMs > METER_PENDING_BUFFER_MS) {
        w.meterWindowStart = prevMs != null ? formatDateTime(new Date(prevMs)) : null;
        w.meterWindowEnd = formatDateTime(new Date(t1));
        w.meterPending = true;
        w.meterLatest = formatDateTime(new Date(latestMeterMs));
        w.expectedMeter = null;
        w.varianceMeter = null;
        w.verdictMeter = "incomplete";
        w.cumShortageMeter = cum === 0 ? null : Math.round(cum);
        prevMs = t1;
        continue;
      }
      const exp = meterDelta(prevMs, t1);
      // record the exact window the meter math ran on (start=prevMs BEFORE advance)
      w.meterWindowStart = prevMs != null ? formatDateTime(new Date(prevMs)) : null;
      w.meterWindowEnd = formatDateTime(new Date(t1));
      // CEO 2026-07-04 · the FIRST collected round (prevMs===null) has no prior baseline,
      // so meterDelta(null,t1) = the ENTIRE lifetime odometer from series start (e.g.
      // Robinsonปราจีน(600) = 42.9B = a 2^32 sentinel coin meter ×10). That is a pre-tracking
      // backlog, NOT a real one-round shortage. Mirror getReconcilePerChair* (which sum only
      // rounds 2..N · commit 3edf27f6): skip the opening round's expected/variance and keep it
      // OUT of cumShortageMeter. Advance prevMs FIRST so round 2 gets its correct baseline.
      const isOpeningRound = prevMs === null;
      prevMs = t1;
      if (isOpeningRound) {
        w.expectedMeter = null;
        w.varianceMeter = null;
        w.verdictMeter = "incomplete"; // renders ⚪/onboarding, not a fake crit
        w.cumShortageMeter = null;
        continue;
      }
      if (exp == null) {
        w.expectedMeter = null;
        w.verdictMeter = "incomplete";
        continue;
      }
      w.expectedMeter = exp;
      const variance = Math.round(w.collectedSum - exp);
      w.varianceMeter = variance;
      w.verdictMeter = perChairVerdict(variance, exp);
      cum += variance;
      w.cumShortageMeter = Math.round(cum);
    }
  }

  // CEO 2026-08-17 · ต่างฝาก / ต่างฝากสะสม — เก็บได้ vs ฝาก ตรงๆ (ช่องว่างที่ทั้ง
  // varianceMeter ด้านบน [ตู้→คนเก็บ] และ diff/cumAfter [ตู้→ธนาคาร] ไม่เคยเช็ค).
  // ข้ามรอบที่ deposit เป็น null (ยังไม่ฝาก/ฝากไปลงรอบอื่นเพราะ bucket คนละวัน) ไม่ให้
  // นับเป็น 0 เท็จ — สะสมคือตัวจับสัญญาณจริง (ต่างรอบเดียวเด้งขึ้นลงได้ปกติจากการหน่วงฝาก).
  {
    let depCum = 0;
    let depCumStarted = false;
    for (const w of wins) {
      if (w.open || w.deposit == null) {
        w.depositDiffCum = depCumStarted ? Math.round(depCum) : null;
        continue;
      }
      const dDiff = Math.round(w.deposit - w.collectedSum);
      w.depositDiff = dDiff;
      depCum += dDiff;
      depCumStarted = true;
      w.depositDiffCum = Math.round(depCum);
    }
  }

  // CEO 2026-08-17 · ยอดต่อใบฝากในตาราง Periods (แทนลิงก์ "สลิป" ตัวเดียวรวมทั้งช่วง
  // — พนักงานบางคนแบ่งฝากหลายใบในช่วงเดียวกัน ต้องเห็นทีละใบพร้อมสถานะของใบนั้น).
  // reuse periodSince เดียวกับ periodCollections ด้านบน (365 วันย้อนหลัง). ยอดที่
  // แสดง = ocrAmount (AI อ่านจากสลิปจริง) ถ้ามี ไม่งั้น fallback depositedAmount
  // (สลิปเก่าก่อน 2026-08-17 ยังไม่มี ocrAmount).
  const periodDeposits = await prisma.chairopsCashDeposit.findMany({
    where: {
      orgId,
      ...(branchId ? { branchId } : {}),
      depositedAt: { gte: periodSince },
    },
    select: {
      id: true,
      depositedAt: true,
      depositedAmount: true,
      ocrAmount: true,
      slipPhotoUrl: true,
      requiresReview: true,
    },
    orderBy: { depositedAt: "asc" },
  });
  const periodLedgerStatusById = await getLedgerStatusMap(
    orgId,
    periodDeposits.map((d) => d.id),
  );
  for (const d of periodDeposits) {
    const idx = findWin(isoDay(d.depositedAt));
    if (idx < 0) continue;
    wins[idx].slips.push({
      id: d.id,
      depositedAt: formatDateTime(d.depositedAt),
      amount: d.ocrAmount ?? d.depositedAmount,
      amountIsOcr: d.ocrAmount != null,
      slipUrl: d.slipPhotoUrl ?? null,
      ledgerStatus: periodLedgerStatusById.get(d.id) ?? "not_sent",
      flagged: d.requiresReview,
    });
  }

  // CEO 2026-08-07 · เดิม cap 12 รอบล่าสุด (slice(0,12)) → CEO ต้องการเลื่อนดูย้อนหลัง
  // "ทั้งหมด" ในหน้าต่างข้อมูล (days:365). loop ด้านบนคำนวณ posSum/cashSum/deposit/diff/
  // cumDrift ครบทุกรอบอยู่แล้ว — เดิมแค่ตัดทิ้งตอน return. เอา cap ออก = โชว์ทุกรอบที่
  // คำนวณไว้แล้ว · ตัวเลขทุกคอลัมน์ (รวม "สะสม") ไม่ขยับ · 0 cost หลังบ้านเพิ่ม.
  return wins.reverse();
}

// ----------------------------------------------------------------
// ACTIVITY — "ใครทำอะไร" (who did what) · per-person summary + per-day log
// CEO 2026-07-01: a 3rd per-chair sub-view beside รายวัน/สรุปรวม. DISPLAY-ONLY —
// reads the SAME collection/deposit rows the money tabs use, never touches the
// drift/ledger math. Optional ?chair= narrows the log to ONE machine (collect
// events whose chairBreakdown includes it); deposits are branch-level lumps so
// they drop out of a machine-filtered view.
// ----------------------------------------------------------------
export type ActivityKind = "collect" | "import" | "deposit";

export interface ActivityPerson {
  /** maidId for collect/deposit · "imp:<userId>" for a CSV importer · "unknown". */
  personKey: string;
  name: string;
  /** ChairopsUserRole (raw enum string) for the badge · null = unknown. */
  role: string | null;
  collectCount: number;
  collectTotal: number;
  depositCount: number;
  depositTotal: number;
  /** distinct Bangkok-days this person did anything in the window. */
  activeDays: number;
}

export interface ActivityEvent {
  kind: ActivityKind;
  /** "HH:mm" Bangkok. */
  time: string;
  personName: string;
  role: string | null;
  amount: number;
  /** machines touched (collect/import from chairBreakdown) · [] for deposits. */
  chairCodes: string[];
  /** CollectionSource for collect/import · null for deposits. */
  source: string | null;
}

export interface ActivityDay {
  date: string; // YYYY-MM-DD (Bangkok)
  events: ActivityEvent[]; // newest-first within the day
  collectTotal: number;
  depositTotal: number;
}

export interface ReconcileActivity {
  from: string;
  to: string;
  people: ActivityPerson[]; // most active first
  days: ActivityDay[]; // newest-first
  chairCodes: string[]; // machine filter options (sorted)
  selectedChair: string | null;
  truncated: boolean;
  maxDays: number;
}

/** Safe extract of chairCodes from a ChairopsCashCollection.chairBreakdown JSON. */
function chairCodesOfBreakdown(bd: unknown): string[] {
  if (!bd || typeof bd !== "object") return [];
  const lines = (bd as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const l of lines) {
    if (l && typeof l === "object") {
      const cc = (l as { chairCode?: unknown }).chairCode;
      if (typeof cc === "string" && cc.trim()) out.push(cc.trim());
    }
  }
  return out;
}

export async function getReconcileActivity(args: {
  orgId: string;
  branchId: string;
  from?: string;
  to?: string;
  allTime?: boolean;
  posCoverThrough?: string | null;
  chair?: string | null;
}): Promise<ReconcileActivity> {
  const { orgId, branchId } = args;
  const selectedChair = args.chair?.trim() || null;

  // Resolve [fromDay, toDay] — SAME window logic as getReconcilePerChairDetail.
  let fromDay: string;
  let toDay: string;
  if (args.allTime) {
    fromDay = "1970-01-01";
    toDay = isoDay(new Date());
  } else if (args.from || args.to) {
    fromDay = args.from ?? "1970-01-01";
    toDay = args.to ?? isoDay(new Date());
  } else {
    const anchor = args.posCoverThrough ?? isoDay(new Date());
    fromDay = isoMinusDaysLocal(anchor, 29);
    toDay = isoDay(new Date());
  }
  let truncated = false;
  if (daysBetween(fromDay, toDay) + 1 > PER_CHAIR_DETAIL_MAX_DAYS) {
    fromDay = isoMinusDaysLocal(toDay, PER_CHAIR_DETAIL_MAX_DAYS - 1);
    truncated = true;
  }

  const collStart = new Date(fromDay + "T00:00:00+07:00");
  const collEnd = new Date(new Date(toDay + "T00:00:00+07:00").getTime() + DAY_MS);

  const [collections, deposits] = await Promise.all([
    prisma.chairopsCashCollection.findMany({
      where: {
        orgId,
        branchId,
        collectedAt: { gte: collStart, lt: collEnd },
        deletedAt: null,
      },
      orderBy: { collectedAt: "desc" },
      select: {
        collectedAt: true,
        countedAmount: true,
        source: true,
        maidId: true,
        importedById: true,
        chairBreakdown: true,
        maid: { select: { displayName: true, role: true } },
        importer: { select: { displayName: true, role: true } },
      },
    }),
    prisma.chairopsCashDeposit.findMany({
      where: {
        orgId,
        branchId,
        depositedAt: { gte: collStart, lt: collEnd },
      },
      orderBy: { depositedAt: "desc" },
      select: {
        depositedAt: true,
        depositedAmount: true,
        depositedByRole: true,
        maidId: true,
        maid: { select: { displayName: true, role: true } },
      },
    }),
  ]);

  // Machine filter options = every chairCode seen in the window's collections.
  const chairOptions = new Set<string>();

  type RawEvent = {
    at: Date;
    kind: ActivityKind;
    personKey: string;
    personName: string;
    role: string | null;
    amount: number;
    chairCodes: string[];
    source: string | null;
  };
  const raw: RawEvent[] = [];

  for (const c of collections) {
    const codes = chairCodesOfBreakdown(c.chairBreakdown);
    codes.forEach((cc) => chairOptions.add(cc));
    const isImport = c.source === "CSV_IMPORT";
    if (isImport) {
      raw.push({
        at: c.collectedAt,
        kind: "import",
        personKey: c.importedById ? `imp:${c.importedById}` : "unknown",
        personName: c.importer?.displayName ?? "ไม่ทราบผู้นำเข้า",
        role: c.importer?.role ?? null,
        amount: c.countedAmount,
        chairCodes: codes,
        source: c.source,
      });
    } else {
      raw.push({
        at: c.collectedAt,
        kind: "collect",
        personKey: c.maidId,
        personName: c.maid?.displayName ?? "ไม่ทราบผู้เก็บ",
        role: c.maid?.role ?? null,
        amount: c.countedAmount,
        chairCodes: codes,
        source: c.source ?? "MAID_MANUAL",
      });
    }
  }
  for (const d of deposits) {
    raw.push({
      at: d.depositedAt,
      kind: "deposit",
      personKey: d.maidId,
      personName: d.maid?.displayName ?? "ไม่ทราบผู้ฝาก",
      role: d.depositedByRole ?? d.maid?.role ?? null,
      amount: d.depositedAmount,
      chairCodes: [],
      source: null,
    });
  }

  // Apply the machine filter: a selected chair keeps only collect/import events
  // that touched it; deposits (branch-level lumps) can't be attributed → drop.
  const filtered = selectedChair
    ? raw.filter(
        (e) => e.kind !== "deposit" && e.chairCodes.includes(selectedChair),
      )
    : raw;

  // Per-person aggregate over the (filtered) events.
  const peopleMap = new Map<string, ActivityPerson>();
  const personDays = new Map<string, Set<string>>();
  for (const e of filtered) {
    let p = peopleMap.get(e.personKey);
    if (!p) {
      p = {
        personKey: e.personKey,
        name: e.personName,
        role: e.role,
        collectCount: 0,
        collectTotal: 0,
        depositCount: 0,
        depositTotal: 0,
        activeDays: 0,
      };
      peopleMap.set(e.personKey, p);
      personDays.set(e.personKey, new Set());
    }
    if (e.kind === "deposit") {
      p.depositCount += 1;
      p.depositTotal += e.amount;
    } else {
      p.collectCount += 1;
      p.collectTotal += e.amount;
    }
    personDays.get(e.personKey)!.add(isoDay(e.at));
  }
  for (const [k, days] of personDays) {
    const p = peopleMap.get(k);
    if (p) p.activeDays = days.size;
  }
  const people = [...peopleMap.values()].sort(
    (a, b) =>
      b.collectTotal + b.depositTotal - (a.collectTotal + a.depositTotal),
  );

  // Group into days (newest-first), events newest-first within each day.
  const dayMap = new Map<string, ActivityDay>();
  for (const e of filtered) {
    const dayKey = isoDay(e.at);
    let day = dayMap.get(dayKey);
    if (!day) {
      day = { date: dayKey, events: [], collectTotal: 0, depositTotal: 0 };
      dayMap.set(dayKey, day);
    }
    const time = new Date(e.at.getTime() + 7 * 3_600_000)
      .toISOString()
      .slice(11, 16);
    day.events.push({
      kind: e.kind,
      time,
      personName: e.personName,
      role: e.role,
      amount: e.amount,
      chairCodes: e.chairCodes,
      source: e.source,
    });
    if (e.kind === "deposit") day.depositTotal += e.amount;
    else day.collectTotal += e.amount;
  }
  const days = [...dayMap.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const d of days) {
    d.events.sort((a, b) => (a.time < b.time ? 1 : -1));
  }

  return {
    from: fromDay,
    to: toDay,
    people,
    days,
    chairCodes: [...chairOptions].sort(),
    selectedChair,
    truncated,
    maxDays: PER_CHAIR_DETAIL_MAX_DAYS,
  };
}

// ----------------------------------------------------------------
// CHECKLIST — monthly "who-collected-which-day" grid (branch × day)
// CEO 2026-07-01: a manager's month-view checklist like the Google Sheet —
// rows = branches, columns = every day 1..31 (no collapsing), each cell shows
// เก็บ/ฝาก/ไม่เก็บ. DISPLAY-ONLY (reads collections+deposits · never money math).
// ----------------------------------------------------------------
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export interface ChecklistCell {
  day: number; // 1..daysInMonth
  collected: boolean;
  deposited: boolean;
  collectedAmount: number;
  depositedAmount: number;
}
export interface ChecklistBranch {
  branchId: string;
  name: string;
  isClosed: boolean;
  cells: ChecklistCell[]; // length = daysInMonth, index 0 = day 1
  collectDays: number;
  totalCollected: number;
  totalDeposited: number;
}
export interface ReconcileChecklist {
  year: number;
  month: number; // 1..12
  daysInMonth: number;
  monthLabel: string; // "กรกฎาคม 2569"
  branches: ChecklistBranch[];
  prevMonth: string; // "YYYY-MM"
  nextMonth: string;
  totalCollectEvents: number;
}

function shiftYm(year: number, month: number, delta: number): string {
  const zero = month - 1 + delta;
  const y = year + Math.floor(zero / 12);
  const m = ((zero % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export async function getReconcileChecklist(args: {
  orgId: string;
  year: number;
  month: number; // 1..12
}): Promise<ReconcileChecklist> {
  const { orgId, year, month } = args;
  const daysInMonth = new Date(year, month, 0).getDate(); // month 1-based → last day
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const collStart = new Date(`${ym}-01T00:00:00+07:00`);
  const collEnd = new Date(
    `${shiftYm(year, month, 1)}-01T00:00:00+07:00`,
  );

  const [branches, collections, deposits] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, closedAt: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: {
        orgId,
        collectedAt: { gte: collStart, lt: collEnd },
        deletedAt: null,
      },
      select: { branchId: true, collectedAt: true, countedAmount: true },
    }),
    prisma.chairopsCashDeposit.findMany({
      where: { orgId, depositedAt: { gte: collStart, lt: collEnd } },
      select: { branchId: true, depositedAt: true, depositedAmount: true },
    }),
  ]);

  // branchId → (dayIndex 0-based → cell)
  const grid = new Map<string, ChecklistCell[]>();
  const ensure = (branchId: string): ChecklistCell[] => {
    let cells = grid.get(branchId);
    if (!cells) {
      cells = Array.from({ length: daysInMonth }, (_, i) => ({
        day: i + 1,
        collected: false,
        deposited: false,
        collectedAmount: 0,
        depositedAmount: 0,
      }));
      grid.set(branchId, cells);
    }
    return cells;
  };
  const dayIdxOf = (d: Date): number => {
    // Bangkok day-of-month, 0-based. Window guarantees it's inside this month.
    return Number(isoDay(d).slice(8, 10)) - 1;
  };

  let totalCollectEvents = 0;
  for (const c of collections) {
    const i = dayIdxOf(c.collectedAt);
    if (i < 0 || i >= daysInMonth) continue;
    const cell = ensure(c.branchId)[i];
    cell.collected = true;
    cell.collectedAmount += c.countedAmount;
    totalCollectEvents += 1;
  }
  for (const d of deposits) {
    const i = dayIdxOf(d.depositedAt);
    if (i < 0 || i >= daysInMonth) continue;
    const cell = ensure(d.branchId)[i];
    cell.deposited = true;
    cell.depositedAmount += d.depositedAmount;
  }

  const outBranches: ChecklistBranch[] = branches.map((b) => {
    const cells = grid.get(b.id) ?? ensure(b.id);
    let collectDays = 0;
    let totalCollected = 0;
    let totalDeposited = 0;
    for (const cell of cells) {
      if (cell.collected) {
        collectDays += 1;
        totalCollected += cell.collectedAmount;
      }
      totalDeposited += cell.depositedAmount;
    }
    return {
      branchId: b.id,
      name: b.name,
      isClosed: b.closedAt != null,
      cells,
      collectDays,
      totalCollected,
      totalDeposited,
    };
  });
  // Closed branches sink to the bottom (same intent as the sidebar sort).
  outBranches.sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    return a.name.localeCompare(b.name, "th");
  });

  return {
    year,
    month,
    daysInMonth,
    monthLabel: `${THAI_MONTHS[month - 1]} ${year + 543}`,
    branches: outBranches,
    prevMonth: shiftYm(year, month, -1),
    nextMonth: shiftYm(year, month, 1),
    totalCollectEvents,
  };
}

// ----------------------------------------------------------------
// CHECKLIST · NUMBERS VIEW — same branch × day grid as getReconcileChecklist()
// but each cell carries the 3 anti-fraud legs (ควรได้/เก็บได้/ฝาก) instead of a
// dot (CEO 2026-08-23). เก็บได้/ฝาก are copied verbatim from
// getReconcileChecklist()'s own cells (SAME rows/query — guaranteed to agree
// with the dot view, never re-derived). ควรได้ is genuinely ROUND-shaped
// (meter-delta over a collection window), not day-shaped — this calls
// getReconcilePeriods() PER BRANCH (the exact function powering the Periods
// tab · does NOT reimplement the meter math) and re-buckets each closed
// round's expectedMeter/varianceMeter onto the calendar day of that round's
// LAST collection instant (lastCollectedAt), summing when >1 round closes on
// the branch the same day. A day with money activity but no VERIFIED round
// closing on it (e.g. its round is still open, or lacks meter coverage) shows
// null/⚪ — never a fabricated ควรได้. DISPLAY-ONLY.
// ----------------------------------------------------------------
export interface NumbersCell {
  day: number; // 1..daysInMonth
  collected: boolean; // === ChecklistCell.collected (identical source)
  deposited: boolean; // === ChecklistCell.deposited
  collectedAmount: number; // === ChecklistCell.collectedAmount
  depositedAmount: number; // === ChecklistCell.depositedAmount
  expectedAmount: number | null; // Σ expectedMeter of rounds whose lastCollectedAt is this day · null = ⚪ no verified round
  variance: number | null; // Σ varianceMeter of the same rounds (เก็บได้ − ควรได้ of THIS day's rounds only, not cumulative)
  verdict: PerChairVerdict | null; // classification of `variance` via the SAME tolerance fn as Periods/รายตู้ · null when no verified round
  roundCount: number; // how many periods/rounds (closed, any verdict) attribute to this day
}
export interface NumbersBranch {
  branchId: string;
  name: string;
  isClosed: boolean;
  cells: NumbersCell[]; // length = daysInMonth, index 0 = day 1
  collectDays: number; // === ChecklistBranch.collectDays
  cumShortfall: number | null; // latest depositDiffCum (ฝาก − เก็บได้, all-time running total as of NOW — same figure getReconcilePeriods() shows on its newest row) · null = branch has no closed period yet
}
export interface ReconcileChecklistNumbers {
  year: number;
  month: number;
  daysInMonth: number;
  monthLabel: string;
  branches: NumbersBranch[];
  prevMonth: string;
  nextMonth: string;
}

export async function getReconcileChecklistNumbers(args: {
  orgId: string;
  year: number;
  month: number;
}): Promise<ReconcileChecklistNumbers> {
  const { orgId, year, month } = args;

  // เก็บได้/ฝาก — reuse the checklist's OWN computation verbatim (never diverge
  // from the dot view for the same branch+day).
  const checklist = await getReconcileChecklist({ orgId, year, month });

  // ควรได้/variance — round-shaped. One getReconcilePeriods() call per active
  // branch, in parallel (CEO accepted this is heavier than the dot checklist:
  // ~N branches × full periods computation vs one flat query).
  const periodsByBranch = await Promise.all(
    checklist.branches.map(async (b) => ({
      branchId: b.branchId,
      periods: await getReconcilePeriods({ orgId, branchId: b.branchId }),
    })),
  );
  const periodsMap = new Map(periodsByBranch.map((p) => [p.branchId, p.periods]));

  const ym = `${year}-${String(month).padStart(2, "0")}`;

  const branches: NumbersBranch[] = checklist.branches.map((cb) => {
    const periods = periodsMap.get(cb.branchId) ?? [];

    // Bucket each CLOSED round's expectedMeter/varianceMeter onto the calendar
    // day of its lastCollectedAt (Bangkok) — the exact instant the meter math
    // used as the round's closing boundary. Skip the open (pending) tail —
    // it isn't a verified round yet.
    const perDay = new Map<
      number,
      { expected: number; variance: number; roundCount: number; verifiedCount: number }
    >();
    for (const p of periods) {
      if (p.open || !p.lastCollectedAt) continue;
      const dayStr = p.lastCollectedAt.slice(0, 10); // "YYYY-MM-DD HH:mm" (Bangkok, see formatDateTime)
      if (!dayStr.startsWith(ym)) continue; // round closed outside the viewed month
      const dayNum = Number(dayStr.slice(8, 10));
      if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > cb.cells.length) continue;
      const acc =
        perDay.get(dayNum) ?? { expected: 0, variance: 0, roundCount: 0, verifiedCount: 0 };
      acc.roundCount += 1;
      // expectedMeter/varianceMeter are set together (see getReconcilePeriods) —
      // only count toward the day's total when the round actually has meter
      // coverage, so an incomplete/pending round never fabricates a ควรได้.
      if (p.expectedMeter != null && p.varianceMeter != null) {
        acc.expected += p.expectedMeter;
        acc.variance += p.varianceMeter;
        acc.verifiedCount += 1;
      }
      perDay.set(dayNum, acc);
    }

    const cells: NumbersCell[] = cb.cells.map((c) => {
      const acc = perDay.get(c.day);
      const verified = !!acc && acc.verifiedCount > 0;
      const expectedAmount = verified ? Math.round(acc!.expected) : null;
      const variance = verified ? Math.round(acc!.variance) : null;
      const verdict =
        verified && expectedAmount != null && variance != null
          ? perChairVerdict(variance, expectedAmount)
          : null;
      return {
        day: c.day,
        collected: c.collected,
        deposited: c.deposited,
        collectedAmount: c.collectedAmount,
        depositedAmount: c.depositedAmount,
        expectedAmount,
        variance,
        verdict,
        roundCount: acc?.roundCount ?? 0,
      };
    });

    // Cumulative shortfall badge — reuse depositDiffCum's running total as-is
    // (do not re-sum it here). getReconcilePeriods() returns periods NEWEST
    // FIRST (wins.reverse()), and every window (including the open tail) carries
    // the running cumulative forward, so the first non-null entry is the latest
    // figure as of now.
    const cumShortfall = periods.find((p) => p.depositDiffCum != null)?.depositDiffCum ?? null;

    return {
      branchId: cb.branchId,
      name: cb.name,
      isClosed: cb.isClosed,
      cells,
      collectDays: cb.collectDays,
      cumShortfall,
    };
  });

  return {
    year: checklist.year,
    month: checklist.month,
    daysInMonth: checklist.daysInMonth,
    monthLabel: checklist.monthLabel,
    branches,
    prevMonth: checklist.prevMonth,
    nextMonth: checklist.nextMonth,
  };
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
      select: { id: true, name: true, mallGroup: true, closedAt: true },
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
      isClosed: b.closedAt != null,
    };
  });

  // CEO 2026-07-01: sort by COLLECTION RECENCY, not money.
  // (CEO: "เรียงตามเก็บเงินดีกว่าเรียงยอด" — เก็บวันนี้เด้งบนสุด · ไม่เคยเก็บลงล่าง ·
  // สาขาปิด/ย้ายแล้วอยู่ล่างสุด.) Fresh (daysSinceCollect asc) first; never-collected
  // (999) naturally sinks; closed branches pinned below everything. Tiebreak by
  // worst shortage first so within the same freshness the money-critical one leads.
  return rows.sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    if (a.daysSinceCollect !== b.daysSinceCollect)
      return a.daysSinceCollect - b.daysSinceCollect;
    return a.cumDrift - b.cumDrift;
  });
}
