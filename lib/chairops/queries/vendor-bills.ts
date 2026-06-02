// ============================================================
// Vendor Bills queries · ChairOps F2 · audit MISS-01 (2026-06-02)
// ============================================================
// Server-only data layer for /chairops/bills:
//   - getBillMatrix({orgId, monthsBack})        → matrix VM (branch × month)
//   - getBillsForBranchMonth({...})             → category rows for one cell
//   - getAnomaly({...})                         → prev-month compare (±20%)
//   - getCategoryList({orgId, includeArchived}) → categories for the picker
//   - getPendingBillsTotal({orgId})             → home-widget summary
//
// Performance:
//   Matrix loads all bills for visible months in ONE prisma query and buckets
//   client-side. Per MISS-01 + task brief: NO N+1.
//
// "Overdue" is DERIVED at read-time:
//   status = paidAt ? "PAID"
//          : (dueDate < bangkokToday) ? "OVERDUE"
//          : "PENDING"
// No DB column for status — paidAt is the only authoritative bit.
//
// Permissions (enforced at the action/route layer · queries are stateless):
//   CEO + ADMIN   → all reads + writes
//   MANAGER       → read-only (any branch)
//   OFFICE        → read-only (any branch)
//   MAID          → blocked entirely (handled in routes)
// ============================================================

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// ----------------------------------------------------------------
// Bangkok timezone helpers (mirrors exec-home.ts pattern · keep local
// so F2 queries don't depend on the exec-home module).
// ----------------------------------------------------------------
function bangkokYmd(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * UTC midnight of today's BKK calendar date — for `@db.Date` columns.
 * Exported (BA-05 fix · 2026-06-03) so detail page can match matrix semantics.
 */
export function bangkokDateOfToday(): Date {
  const ymd = bangkokYmd(new Date());
  return new Date(`${ymd}T00:00:00Z`);
}

/** UTC midnight of the 1st of the BKK calendar month (relative to today). */
function bangkokFirstOfMonth(monthsBack: number): Date {
  const ymd = bangkokYmd(new Date());
  const [yStr, mStr] = ymd.split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  // monthsBack=0 → current month; monthsBack=5 → 5 months ago
  let targetY = y;
  let targetM = m - monthsBack;
  while (targetM <= 0) {
    targetM += 12;
    targetY -= 1;
  }
  const mm = String(targetM).padStart(2, "0");
  return new Date(`${targetY}-${mm}-01T00:00:00Z`);
}

/** ISO month-key "YYYY-MM" from a Date (UTC parts · since billPeriod is @db.Date). */
function monthKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

/** Add `n` months to a UTC-midnight Date · returns a new Date. */
function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + n, 1));
}

function decToNum(
  d: { toNumber: () => number } | number | null | undefined,
): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return d.toNumber();
}

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
export type BillStatus = "PENDING" | "PAID" | "OVERDUE";

export interface BillRowVM {
  id: string;
  branchId: string;
  branchName: string;
  billPeriod: Date; // 1st of month (UTC midnight)
  monthKey: string; // "YYYY-MM"
  categoryId: string;
  categoryCode: string;
  categoryLabel: string;
  amount: number;
  dueDate: Date;
  paidAt: Date | null;
  paidAmount: number | null;
  slipPhotoUrl: string | null;
  bankAccountTo: string | null;
  paymentTerms: string | null;
  notes: string | null;
  status: BillStatus;
  /** ±20% off prior-month bill in same (branch, category). UX-01 · 2026-06-03. */
  isAnomalous: boolean;
  /** (current - prev) / prev · null when no prior. */
  deltaPct: number | null;
}

export interface MatrixCellVM {
  /** Branch + month total (sum of all category amounts). */
  total: number;
  /** Same total, restricted to PAID bills only. */
  paidTotal: number;
  /** Sum of OVERDUE bills (derived status, paidAt IS NULL AND dueDate < today). */
  overdueTotal: number;
  /** Sum of PENDING (not paid, not yet overdue). */
  pendingTotal: number;
  /** Worst status across the cell — drives the color chip. */
  worstStatus: BillStatus | null;
  /**
   * True when any bill in the cell is ±20% off the prior-month bill for the
   * same (branch, category). UX-01 fix · 2026-06-03.
   */
  isAnomalous: boolean;
  /** Underlying bills (already filtered to the cell). */
  bills: BillRowVM[];
}

export interface MatrixBranchVM {
  branchId: string;
  branchName: string;
  /** Map keyed by monthKey "YYYY-MM" → cell VM. */
  cellsByMonth: Map<string, MatrixCellVM>;
  /** Sum across visible months. */
  rowTotal: number;
}

export interface BillMatrixVM {
  branches: MatrixBranchVM[];
  /** Visible months oldest → newest · each entry is the 1st of the month. */
  months: Array<{ monthKey: string; firstOfMonth: Date }>;
  /** Sum across all branches per month (column footer). */
  totalsByMonth: Map<string, number>;
  /** Grand total across visible window. */
  grandTotal: number;
}

export interface CategoryVM {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface AnomalyVM {
  /** Prev-month bill amount for same branch+category, or null when none. */
  prev: number | null;
  /** (current - prev) / prev · null when prev is null or 0. */
  deltaPct: number | null;
  /** True when |deltaPct| > 20% (CEO threshold). */
  isAnomalous: boolean;
  /** Previous bill's billPeriod (so UI can label "เดือนก่อน ..."). */
  prevPeriod: Date | null;
}

export interface PendingBillsSummary {
  count: number;
  pendingAmount: number;
  overdueCount: number;
  overdueAmount: number;
}

// ----------------------------------------------------------------
// Status derivation
// ----------------------------------------------------------------
/**
 * Single source of truth for PAID/PENDING/OVERDUE. Exported (BA-05 fix ·
 * 2026-06-03) so the detail page can share the same clock as the matrix —
 * earlier the detail page compared dueDate against wall-clock `now()` while
 * the matrix compared against BKK calendar midnight, creating a 7-hour
 * window (BKK 00:00-07:00) where the two surfaces disagreed.
 */
export function deriveStatus(
  paidAt: Date | null,
  dueDate: Date,
  today: Date,
): BillStatus {
  if (paidAt) return "PAID";
  if (dueDate.getTime() < today.getTime()) return "OVERDUE";
  return "PENDING";
}

const STATUS_RANK: Record<BillStatus, number> = {
  PAID: 0,
  PENDING: 1,
  OVERDUE: 2,
};

// ----------------------------------------------------------------
// getBillMatrix — main 2-axis view (branch rows × month columns)
// ----------------------------------------------------------------
export async function getBillMatrix(args: {
  orgId: string;
  /** Number of months in the visible window. Default 6 · max 24. */
  monthsBack?: number;
}): Promise<BillMatrixVM> {
  const { orgId } = args;
  const monthsBack = Math.max(1, Math.min(24, args.monthsBack ?? 6));
  const today = bangkokDateOfToday();

  // Oldest visible month (1st-of-month UTC) · we go monthsBack-1 months back
  // so that monthsBack=6 → 6 columns: 5 months ago … current month.
  const firstMonth = bangkokFirstOfMonth(monthsBack - 1);

  // Build month list oldest → newest.
  const months: Array<{ monthKey: string; firstOfMonth: Date }> = [];
  for (let i = 0; i < monthsBack; i++) {
    const m = addMonths(firstMonth, i);
    months.push({ monthKey: monthKey(m), firstOfMonth: m });
  }

  // Single window query (no N+1) — fetch every bill whose billPeriod falls
  // inside the visible window. We also fetch one month BEFORE the window to
  // power the per-cell ±20% anomaly chip without an extra round-trip.
  const windowEnd = addMonths(firstMonth, monthsBack); // exclusive upper bound
  const anomalyLookbackStart = addMonths(firstMonth, -1);
  const [activeBranches, bills, categories, priorBills] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.chairopsVendorBill.findMany({
      where: {
        orgId,
        billPeriod: {
          gte: firstMonth,
          lt: windowEnd,
        },
      },
      orderBy: [{ billPeriod: "asc" }, { dueDate: "asc" }],
    }),
    prisma.chairopsExpenseCategory.findMany({
      where: { orgId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, label: true },
    }),
    // UX-01 (2026-06-03) · one month of lookback so the matrix can flag
    // ±20% anomalies inline without per-cell extra queries.
    prisma.chairopsVendorBill.findMany({
      where: {
        orgId,
        billPeriod: { gte: anomalyLookbackStart, lt: firstMonth },
      },
      select: { branchId: true, categoryId: true, billPeriod: true, amount: true },
    }),
  ]);

  // QA-01 (2026-06-03) · also include inactive branches that still have
  // bills in the visible window — otherwise pending KPI and matrix grand
  // total diverge and CEO loses sight of bills owed by closed branches.
  const billBranchIds = new Set(bills.map((b) => b.branchId));
  const activeIds = new Set(activeBranches.map((b) => b.id));
  const missingIds = [...billBranchIds].filter((id) => !activeIds.has(id));
  const inactiveBranches = missingIds.length
    ? await prisma.chairopsBranch.findMany({
        where: { orgId, id: { in: missingIds } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      })
    : [];
  const branches = [...activeBranches, ...inactiveBranches];

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const branchById = new Map(branches.map((b) => [b.id, b]));

  // Index prior bills by (branchId|categoryId|monthKey) so the inner loop
  // is O(1) lookup. Anomaly compares cell's month-1 against itself.
  const priorByKey = new Map<string, number>();
  for (const p of priorBills) {
    const k = `${p.branchId}|${p.categoryId}|${monthKey(p.billPeriod)}`;
    priorByKey.set(k, (priorByKey.get(k) ?? 0) + decToNum(p.amount));
  }
  // Also fold bills inside the window so cell N has access to cell N-1 inside
  // the same query (i.e. April anomaly compares against March even when both
  // months are visible columns).
  const windowByKey = new Map<string, number>();
  for (const b of bills) {
    const k = `${b.branchId}|${b.categoryId}|${monthKey(b.billPeriod)}`;
    windowByKey.set(k, (windowByKey.get(k) ?? 0) + decToNum(b.amount));
  }
  function prevMonthKey(mk: string): string {
    const [y, m] = mk.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1));
    return monthKey(prev);
  }
  function anomalyFor(branchId: string, categoryId: string, mk: string, amt: number): {
    isAnomalous: boolean;
    deltaPct: number | null;
  } {
    const prevMk = prevMonthKey(mk);
    const key = `${branchId}|${categoryId}|${prevMk}`;
    const prev = windowByKey.get(key) ?? priorByKey.get(key) ?? 0;
    if (prev <= 0) return { isAnomalous: false, deltaPct: null };
    const deltaPct = (amt - prev) / prev;
    return { isAnomalous: Math.abs(deltaPct) > 0.2, deltaPct };
  }

  // Bucket bills into (branchId, monthKey).
  type Bucket = { bills: BillRowVM[] };
  const buckets = new Map<string, Bucket>();
  const bucketKey = (branchId: string, mk: string) => `${branchId}::${mk}`;

  for (const b of bills) {
    const branch = branchById.get(b.branchId);
    if (!branch) continue; // bill points to a branch outside this org (defensive)
    const cat = categoryById.get(b.categoryId);
    const mk = monthKey(b.billPeriod);
    const amt = decToNum(b.amount);
    const anom = anomalyFor(b.branchId, b.categoryId, mk, amt);
    const vm: BillRowVM = {
      id: b.id,
      branchId: b.branchId,
      branchName: branch.name,
      billPeriod: b.billPeriod,
      monthKey: mk,
      categoryId: b.categoryId,
      categoryCode: cat?.code ?? "UNKNOWN",
      categoryLabel: cat?.label ?? "—",
      amount: amt,
      dueDate: b.dueDate,
      paidAt: b.paidAt,
      paidAmount: b.paidAmount == null ? null : decToNum(b.paidAmount),
      slipPhotoUrl: b.slipPhotoUrl,
      bankAccountTo: b.bankAccountTo,
      paymentTerms: b.paymentTerms,
      notes: b.notes,
      status: deriveStatus(b.paidAt, b.dueDate, today),
      isAnomalous: anom.isAnomalous,
      deltaPct: anom.deltaPct,
    };
    const k = bucketKey(b.branchId, mk);
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = { bills: [] };
      buckets.set(k, bucket);
    }
    bucket.bills.push(vm);
  }

  const totalsByMonth = new Map<string, number>(
    months.map(({ monthKey: mk }) => [mk, 0]),
  );
  let grandTotal = 0;

  const branchVMs: MatrixBranchVM[] = branches.map((b) => {
    const cellsByMonth = new Map<string, MatrixCellVM>();
    let rowTotal = 0;
    for (const { monthKey: mk } of months) {
      const bucket = buckets.get(bucketKey(b.id, mk));
      const billsArr = bucket?.bills ?? [];
      let total = 0;
      let paidTotal = 0;
      let overdueTotal = 0;
      let pendingTotal = 0;
      let worst: BillStatus | null = null;
      let cellAnomalous = false;
      for (const bill of billsArr) {
        total += bill.amount;
        if (bill.status === "PAID") paidTotal += bill.amount;
        else if (bill.status === "OVERDUE") overdueTotal += bill.amount;
        else pendingTotal += bill.amount;
        if (worst === null || STATUS_RANK[bill.status] > STATUS_RANK[worst]) {
          worst = bill.status;
        }
        if (bill.isAnomalous) cellAnomalous = true;
      }
      cellsByMonth.set(mk, {
        total,
        paidTotal,
        overdueTotal,
        pendingTotal,
        worstStatus: worst,
        isAnomalous: cellAnomalous,
        bills: billsArr,
      });
      rowTotal += total;
      totalsByMonth.set(mk, (totalsByMonth.get(mk) ?? 0) + total);
      grandTotal += total;
    }
    return {
      branchId: b.id,
      branchName: b.name,
      cellsByMonth,
      rowTotal,
    };
  });

  return {
    branches: branchVMs,
    months,
    totalsByMonth,
    grandTotal,
  };
}

// ----------------------------------------------------------------
// getBillsForBranchMonth — drill-down per cell
// ----------------------------------------------------------------
export async function getBillsForBranchMonth(args: {
  orgId: string;
  branchId: string;
  billPeriod: Date; // any date inside the target month · we floor to 1st-of-month
}): Promise<BillRowVM[]> {
  const today = bangkokDateOfToday();
  const periodFirst = new Date(
    Date.UTC(
      args.billPeriod.getUTCFullYear(),
      args.billPeriod.getUTCMonth(),
      1,
    ),
  );
  const periodNext = addMonths(periodFirst, 1);

  const [bills, categories, branch] = await Promise.all([
    prisma.chairopsVendorBill.findMany({
      where: {
        orgId: args.orgId,
        branchId: args.branchId,
        billPeriod: { gte: periodFirst, lt: periodNext },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.chairopsExpenseCategory.findMany({
      where: { orgId: args.orgId },
      select: { id: true, code: true, label: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.chairopsBranch.findFirst({
      where: { id: args.branchId, orgId: args.orgId },
      select: { name: true },
    }),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const branchName = branch?.name ?? "—";

  return bills.map((b) => {
    const cat = catById.get(b.categoryId);
    return {
      id: b.id,
      branchId: b.branchId,
      branchName,
      billPeriod: b.billPeriod,
      monthKey: monthKey(b.billPeriod),
      categoryId: b.categoryId,
      categoryCode: cat?.code ?? "UNKNOWN",
      categoryLabel: cat?.label ?? "—",
      amount: decToNum(b.amount),
      dueDate: b.dueDate,
      paidAt: b.paidAt,
      paidAmount: b.paidAmount == null ? null : decToNum(b.paidAmount),
      slipPhotoUrl: b.slipPhotoUrl,
      bankAccountTo: b.bankAccountTo,
      paymentTerms: b.paymentTerms,
      notes: b.notes,
      status: deriveStatus(b.paidAt, b.dueDate, today),
      // Drill-down view doesn't surface the chip — defaults are safe.
      isAnomalous: false,
      deltaPct: null,
    };
  });
}

// ----------------------------------------------------------------
// getAnomaly — ±20% prior-month compare for the bill form
// ----------------------------------------------------------------
export async function getAnomaly(args: {
  orgId: string;
  branchId: string;
  categoryId: string;
  /** New bill's billPeriod (any date inside the target month). */
  billPeriod: Date;
  amount: number;
}): Promise<AnomalyVM> {
  const periodFirst = new Date(
    Date.UTC(
      args.billPeriod.getUTCFullYear(),
      args.billPeriod.getUTCMonth(),
      1,
    ),
  );
  // Look back up to 6 months for the most recent prior bill (handles seasonal
  // gaps like deposit-only months without falsely warning).
  const sixBack = addMonths(periodFirst, -6);

  const prior = await prisma.chairopsVendorBill.findFirst({
    where: {
      orgId: args.orgId,
      branchId: args.branchId,
      categoryId: args.categoryId,
      billPeriod: { gte: sixBack, lt: periodFirst },
    },
    orderBy: { billPeriod: "desc" },
    select: { amount: true, billPeriod: true },
  });

  if (!prior) {
    return { prev: null, deltaPct: null, isAnomalous: false, prevPeriod: null };
  }
  const prev = decToNum(prior.amount);
  if (prev <= 0) {
    return {
      prev,
      deltaPct: null,
      isAnomalous: false,
      prevPeriod: prior.billPeriod,
    };
  }
  const deltaPct = (args.amount - prev) / prev;
  return {
    prev,
    deltaPct,
    isAnomalous: Math.abs(deltaPct) > 0.2,
    prevPeriod: prior.billPeriod,
  };
}

// ----------------------------------------------------------------
// getCategoryList — used by every form + the categories page
// ----------------------------------------------------------------
export const getCategoryList = cache(
  async (args: {
    orgId: string;
    includeArchived?: boolean;
  }): Promise<CategoryVM[]> => {
    const rows = await prisma.chairopsExpenseCategory.findMany({
      where: {
        orgId: args.orgId,
        ...(args.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      sortOrder: r.sortOrder,
      archivedAt: r.archivedAt,
    }));
  },
);

// ----------------------------------------------------------------
// getPendingBillsTotal — KPI tile on /chairops (office home)
// PERF-02 / DEVIL-03 (2026-06-03) · was a findMany scan over every
// unpaid row + JS loop on every page render. Now two Prisma aggregates
// (count + sum) and the result is unstable_cache'd · tagged
// "chairops:pending-bills" so bill mutations can revalidate granularly
// instead of broad revalidatePath('/chairops').
// ----------------------------------------------------------------
async function getPendingBillsTotalImpl(args: {
  orgId: string;
  todayMs: number;
}): Promise<PendingBillsSummary> {
  const today = new Date(args.todayMs);
  const [pendingAgg, overdueAgg] = await Promise.all([
    prisma.chairopsVendorBill.aggregate({
      where: { orgId: args.orgId, paidAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.chairopsVendorBill.aggregate({
      where: {
        orgId: args.orgId,
        paidAt: null,
        dueDate: { lt: today },
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  return {
    count: pendingAgg._count._all,
    pendingAmount: decToNum(pendingAgg._sum.amount),
    overdueCount: overdueAgg._count._all,
    overdueAmount: decToNum(overdueAgg._sum.amount),
  };
}

export async function getPendingBillsTotal(args: {
  orgId: string;
}): Promise<PendingBillsSummary> {
  const today = bangkokDateOfToday();
  // Tag-scoped cache · refreshes on bill.create/update/delete/markPaid via
  // revalidateTag("chairops:pending-bills"). Key includes today's BKK date
  // so the OVERDUE filter rolls over correctly at BKK midnight.
  const cached = unstable_cache(
    () => getPendingBillsTotalImpl({ orgId: args.orgId, todayMs: today.getTime() }),
    ["chairops:pending-bills", args.orgId, bangkokYmd(new Date())],
    { tags: ["chairops:pending-bills"], revalidate: 300 },
  );
  return cached();
}
