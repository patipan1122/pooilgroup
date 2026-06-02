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

/** UTC midnight of today's BKK calendar date — for `@db.Date` columns. */
function bangkokDateOfToday(): Date {
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
function deriveStatus(
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
  // inside the visible window.
  const windowEnd = addMonths(firstMonth, monthsBack); // exclusive upper bound
  const [branches, bills, categories] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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
  ]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const branchById = new Map(branches.map((b) => [b.id, b]));

  // Bucket bills into (branchId, monthKey).
  type Bucket = { bills: BillRowVM[] };
  const buckets = new Map<string, Bucket>();
  const bucketKey = (branchId: string, mk: string) => `${branchId}::${mk}`;

  for (const b of bills) {
    const branch = branchById.get(b.branchId);
    if (!branch) continue; // bill points to a branch outside this org (defensive)
    const cat = categoryById.get(b.categoryId);
    const mk = monthKey(b.billPeriod);
    const vm: BillRowVM = {
      id: b.id,
      branchId: b.branchId,
      branchName: branch.name,
      billPeriod: b.billPeriod,
      monthKey: mk,
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
      for (const bill of billsArr) {
        total += bill.amount;
        if (bill.status === "PAID") paidTotal += bill.amount;
        else if (bill.status === "OVERDUE") overdueTotal += bill.amount;
        else pendingTotal += bill.amount;
        if (worst === null || STATUS_RANK[bill.status] > STATUS_RANK[worst]) {
          worst = bill.status;
        }
      }
      cellsByMonth.set(mk, {
        total,
        paidTotal,
        overdueTotal,
        pendingTotal,
        worstStatus: worst,
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
// ----------------------------------------------------------------
export async function getPendingBillsTotal(args: {
  orgId: string;
}): Promise<PendingBillsSummary> {
  const today = bangkokDateOfToday();
  const rows = await prisma.chairopsVendorBill.findMany({
    where: {
      orgId: args.orgId,
      paidAt: null,
    },
    select: { amount: true, dueDate: true },
  });

  let count = 0;
  let pendingAmount = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  for (const r of rows) {
    const amt = decToNum(r.amount);
    count += 1;
    pendingAmount += amt;
    if (r.dueDate.getTime() < today.getTime()) {
      overdueCount += 1;
      overdueAmount += amt;
    }
  }
  return { count, pendingAmount, overdueCount, overdueAmount };
}
