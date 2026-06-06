// LedgerLine · "สมุดค่าใช้จ่ายรายประเภท" (Category Ledger · C1 / tier 7a).
//
// CEO's "เล่มสมุดค่าใช้จ่าย ดูย้อนหลังดูความเปลี่ยนแปลง": pick ONE category →
// see all its expenses over time, grouped by month (YYYY-MM) with a monthly total
// + the rows, newest month first. Two axes:
//   • by CATEGORY (whole company)            → branchId omitted
//   • by CATEGORY × BRANCH ("ค่าไฟ ของสาขา A") → branchId pinned
//
// Tier 7a ONLY = history + trend. NO recurring-bill alerts here (that is a later
// tier and deliberately out of scope).
//
// SCOPING — defence in depth (same rule as queries.ts after the cross-org-leak
// audits): EVERY read filters BOTH orgId AND companyId. One org = many legal
// entities (Pooil + JP Sync, separate VAT) → a companyId-less read would leak
// another company's spend. We ALSO honour the actor's branch scope: a LINE member
// who only covers สาขา A must never see สาขา B's electricity bill, even via the
// "whole company" axis. Admin/accountant (allBranches) see company-wide.
//
// "Real spend only" = confirmed + locked, matching dashboard.ts SPEND_STATUS.
// Drafts aren't money yet and voided rows are cancelled, so neither belongs in
// the historical trend. (Void rows still stay visible in the รายการ list — they
// are merely excluded from this spend roll-up.)

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

type DecimalLike = { toNumber: () => number } | number | null | undefined;
function dec(v: DecimalLike): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

/** Confirmed/locked = real historical spend. Drafts/void excluded from the book. */
const SPEND_STATUS = ["confirmed", "locked"] as const;

/** The actor's branch reach — mirrors LedgerActor (liff-auth.ts) so the same
 *  scope rule governs web pages and the LIFF without importing server-only code. */
export interface CategoryLedgerActorScope {
  /** true = admin/accountant tier → company-wide (no branch narrowing). */
  allBranches: boolean;
  /** Branch ids a scoped member may see (ignored when allBranches). */
  scopeBranchIds: string[];
}

/** One expense row inside a month group (only the fields the book renders). */
export interface CategoryLedgerRow {
  id: string;
  docCode: string;
  vendor: string | null;
  /** Document date — YYYY-MM-DD (Bangkok-naive UTC, same as the rest of ledger). */
  docDate: string | null;
  total: number;
  branchId: string | null;
  branchName: string | null;
  status: string;
}

/** One month bucket: YYYY-MM, its summed total, the rows (newest doc first). */
export interface CategoryLedgerMonth {
  /** YYYY-MM. */
  period: string;
  total: number;
  count: number;
  rows: CategoryLedgerRow[];
}

export interface CategoryLedgerResult {
  categoryId: string;
  categoryName: string | null;
  /** Resolved branch name when the axis is CATEGORY × BRANCH (else null). */
  branchId: string | null;
  branchName: string | null;
  /** Months newest-first. Empty array = no real spend yet in scope. */
  months: CategoryLedgerMonth[];
  /** Sum of every month (grand total across the visible history). */
  grandTotal: number;
  /** Total receipt count across all months. */
  grandCount: number;
}

export interface CategoryLedgerInput {
  orgId: string;
  companyId: string;
  categoryId: string;
  /** Pin to ONE branch (axis = CATEGORY × BRANCH). Omit/null = whole company. */
  branchId?: string | null;
  /** The viewer's branch reach — narrows what a scoped member may total. */
  actorScope: CategoryLedgerActorScope;
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Bucket a doc date → YYYY-MM (same UTC-bucketing convention as _data.ts
 *  expenseByMonth / dashboard.ts spendByMonth — keeps month labels consistent
 *  across the dashboard, the book, and the trend chart). */
function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Build the category ledger book for ONE category, grouped by month, newest
 * month first, every row carrying its branch. Always org+company scoped and
 * narrowed to the actor's branch reach.
 *
 * Returns months descending; within a month rows are newest-doc-first. A scoped
 * member with NO reachable branches (allBranches=false, empty scope) gets an
 * empty book — never a company-wide leak.
 */
export async function categoryLedger(
  input: CategoryLedgerInput,
): Promise<CategoryLedgerResult> {
  const { orgId, companyId, categoryId, branchId, actorScope } = input;

  // Base scope — org + company + this category + real-spend statuses only.
  const where: Prisma.LedgerExpenseWhereInput = {
    orgId,
    companyId,
    categoryId,
    status: { in: [...SPEND_STATUS] },
  };

  // Axis: an explicit branch pins the book to that one branch — BUT a scoped
  // member may only pin a branch they can actually reach (else empty, no leak).
  if (branchId) {
    if (!actorScope.allBranches && !actorScope.scopeBranchIds.includes(branchId)) {
      return emptyResult(categoryId, branchId, null);
    }
    where.branchId = branchId;
  } else if (!actorScope.allBranches) {
    // Whole-company axis for a scoped member → restrict to their branches only.
    // No reachable branch → empty book (defence in depth, never company-wide).
    if (actorScope.scopeBranchIds.length === 0) {
      return emptyResult(categoryId, null, null);
    }
    where.branchId = { in: actorScope.scopeBranchIds };
  }

  const rows = await prisma.ledgerExpense.findMany({
    where,
    select: {
      id: true,
      docCode: true,
      vendor: true,
      docDate: true,
      total: true,
      branchId: true,
      status: true,
      category: { select: { name: true } },
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    // Bound the read — a single category over time is far smaller than the whole
    // ledger, but cap defensively so a misconfigured category can't stream forever.
    take: 1000,
  });

  // Resolve branch names in ONE round-trip (book rows + the pinned-branch label).
  const branchIds = new Set<string>();
  for (const r of rows) if (r.branchId) branchIds.add(r.branchId);
  if (branchId) branchIds.add(branchId);
  const branches =
    branchIds.size > 0
      ? await prisma.branch.findMany({
          where: { id: { in: [...branchIds] }, orgId, companyId },
          select: { id: true, name: true },
        })
      : [];
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  const categoryName = rows[0]?.category?.name ?? null;

  // Group into month buckets (insertion order = newest-first because rows are
  // already docDate-desc → the first row of each new period seeds its bucket).
  const byPeriod = new Map<string, CategoryLedgerMonth>();
  let grandTotal = 0;
  for (const r of rows) {
    const amt = dec(r.total);
    grandTotal += amt;
    const period = r.docDate ? periodOf(r.docDate) : "ไม่ระบุเดือน";
    let bucket = byPeriod.get(period);
    if (!bucket) {
      bucket = { period, total: 0, count: 0, rows: [] };
      byPeriod.set(period, bucket);
    }
    bucket.total += amt;
    bucket.count += 1;
    bucket.rows.push({
      id: r.id,
      docCode: r.docCode,
      vendor: r.vendor,
      docDate: isoDate(r.docDate),
      total: amt,
      branchId: r.branchId,
      branchName: r.branchId ? branchNameById.get(r.branchId) ?? null : null,
      status: r.status,
    });
  }

  // Map preserves the docDate-desc seeding order; rows with no date sort last.
  const months = [...byPeriod.values()].sort((a, b) => {
    if (a.period === "ไม่ระบุเดือน") return 1;
    if (b.period === "ไม่ระบุเดือน") return -1;
    return a.period < b.period ? 1 : a.period > b.period ? -1 : 0;
  });

  return {
    categoryId,
    categoryName,
    branchId: branchId ?? null,
    branchName: branchId ? branchNameById.get(branchId) ?? null : null,
    months,
    grandTotal,
    grandCount: rows.length,
  };
}

function emptyResult(
  categoryId: string,
  branchId: string | null,
  branchName: string | null,
): CategoryLedgerResult {
  return {
    categoryId,
    categoryName: null,
    branchId,
    branchName,
    months: [],
    grandTotal: 0,
    grandCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Ledger-book index — every active category's latest-month total + a sparkline
// series, for /ledger/ledger-book. One groupBy over the spend window instead of
// N per-category queries (avoids N+1 across ~dozens of categories).
// ---------------------------------------------------------------------------

export interface CategoryBookEntry {
  categoryId: string;
  categoryName: string;
  color: string | null;
  /** Latest month that actually has spend (YYYY-MM) — null if none ever. */
  latestPeriod: string | null;
  /** Total in that latest month. */
  latestTotal: number;
  /** Trailing-N-month totals oldest→newest (for the sparkline, includes zeros). */
  spark: number[];
  /** The YYYY-MM labels matching `spark`, oldest→newest. */
  sparkPeriods: string[];
}

/**
 * For the standalone "สมุดค่าใช้จ่าย" page: every active category with its
 * latest-month total + a trailing `months`-month spend series (the sparkline).
 * Real spend only (confirmed+locked), org+company scoped, narrowed to the
 * actor's branch reach. Categories with zero history still appear (flat line).
 */
export async function categoryBookIndex(input: {
  orgId: string;
  companyId: string;
  actorScope: CategoryLedgerActorScope;
  /** Trailing window length for the sparkline (default 6). */
  months?: number;
  /** Anchor month (YYYY-MM) the window ends on — caller passes Bangkok current. */
  anchorPeriod: string;
}): Promise<CategoryBookEntry[]> {
  const { orgId, companyId, actorScope, anchorPeriod } = input;
  const months = input.months ?? 6;

  const categories = await prisma.ledgerCategory.findMany({
    where: { orgId, companyId, active: true },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
    select: { id: true, name: true, color: true },
  });
  if (categories.length === 0) return [];

  // Window = trailing `months` ending at the anchor (inclusive). Build the
  // oldest→newest label list, then the UTC lower bound for the query.
  const periods: string[] = [];
  for (let i = months - 1; i >= 0; i--) periods.push(shift(anchorPeriod, -i));
  const [sy, sm] = periods[0].split("-").map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, 1));

  const where: Prisma.LedgerExpenseWhereInput = {
    orgId,
    companyId,
    status: { in: [...SPEND_STATUS] },
    docDate: { gte: start },
  };
  // Scoped member → only their branches contribute (defence in depth).
  if (!actorScope.allBranches) {
    if (actorScope.scopeBranchIds.length === 0) {
      // No reachable branch → every category is flat-zero (still listed).
      return categories.map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        color: c.color,
        latestPeriod: null,
        latestTotal: 0,
        spark: periods.map(() => 0),
        sparkPeriods: periods,
      }));
    }
    where.branchId = { in: actorScope.scopeBranchIds };
  }

  const rows = await prisma.ledgerExpense.findMany({
    where,
    select: { categoryId: true, docDate: true, total: true },
  });

  // Build per-category period→total buckets.
  const byCat = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.categoryId || !r.docDate) continue;
    const period = periodOf(r.docDate);
    let m = byCat.get(r.categoryId);
    if (!m) {
      m = new Map();
      byCat.set(r.categoryId, m);
    }
    m.set(period, (m.get(period) ?? 0) + dec(r.total));
  }

  return categories.map((c) => {
    const m = byCat.get(c.id);
    const spark = periods.map((p) => (m?.get(p) ?? 0));
    // Latest non-zero month within the window (sparkline reflects only the window;
    // the headline "latest" uses the same window for honesty/consistency).
    let latestPeriod: string | null = null;
    let latestTotal = 0;
    for (let i = periods.length - 1; i >= 0; i--) {
      if (spark[i] > 0) {
        latestPeriod = periods[i];
        latestTotal = spark[i];
        break;
      }
    }
    return {
      categoryId: c.id,
      categoryName: c.name,
      color: c.color,
      latestPeriod,
      latestTotal,
      spark,
      sparkPeriods: periods,
    };
  });
}

/** Local YYYY-MM shift (kept local so the file has no server-only dep beyond prisma). */
function shift(period: string, monthsDelta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + monthsDelta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
