// LedgerLine · "สมุดค่าใช้จ่าย" spend-analytics (workshop 2026-06-07, flag LEDGER_ANALYTICS_V1).
//
// NOTE: distinct from lib/ledger/insights.ts (the AI dashboard-narrative generator).
// This is the deterministic faceted pivot + keyword search behind /ledger/ledger-book.
//
// CEO's target = the Google sheet he keeps by hand ("ค่าน้ำ ค่าไฟ JPSYNC"):
// pick ONE category → rows = BRANCH × columns = MONTHS × cell = ยอด, + a total
// row. This engine generalises that into a faceted pivot the sheet can't do:
//   • rowAxis  : branch | category | vendor | person  (what the rows are)
//   • filters  : categoryId, branchId, vendor, search(keyword)  (tick to narrow)
//   • grain    : month (trailing N months) | year (trailing N years)
//   • basis    : net (subtotal — เทียบราคาจริง, DEFAULT) | gross (total — เงินสดจ่าย)
// plus a keyword SEARCH ("น้ำแข็ง") over line-item descriptions + vendor → the
// last buys with their unit price ("ล่าสุดซื้อกี่บาท"), branch-filterable.
//
// READ-ONLY: never writes. Mirrors category-ledger.ts scoping EXACTLY —
//   • EVERY query filters BOTH orgId AND companyId (one org = many legal
//     entities → a companyId-less read leaks another company's spend; this was a
//     live P0). Vendor strings especially leak across companies (no master).
//   • honours the actor's branch reach (scoped LINE member never sees another
//     branch, even via a "whole company" axis).
//   • real spend only = confirmed + locked, AND excludes superseded rows
//     (replacedById != null) so a quotation replaced by its real invoice is not
//     double-counted (matches the never-double-count rule).
//
// Aggregation reads only the few needed columns then buckets in JS (no findMany
// take:1000 silent truncation — we read with a high safety cap and surface
// `truncated` if ever hit). For ONE company's confirmed spend this is a small
// read; correctness + no-silent-drop beats a fragile raw-SQL pivot.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

type DecimalLike = { toNumber: () => number } | number | null | undefined;
function dec(v: DecimalLike): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

const SPEND_STATUS = ["confirmed", "locked"] as const;
/** Safety bound — far above one company's realistic confirmed-row count; if hit
 *  we set `truncated` so the UI can warn instead of silently dropping spend. */
const READ_CAP = 20000;

export type RowAxis = "branch" | "category" | "vendor" | "person";
export type TimeGrain = "month" | "year";
export type AmountBasis = "net" | "gross";

/** Mirrors CategoryLedgerActorScope (liff-auth LedgerActor) — same scope rule. */
export interface AnalyticsActorScope {
  allBranches: boolean;
  scopeBranchIds: string[];
}

export interface PivotInput {
  orgId: string;
  companyId: string;
  actorScope: AnalyticsActorScope;
  rowAxis: RowAxis;
  /** Faceted filters (tick MANY to narrow) — all optional, all AND-combined.
   *  Multi-select: within a facet the values are OR'd ({ in: [...] }); across
   *  facets they're AND'd (หมวด∈{...} AND สาขา∈{...} AND ผู้ขาย∈{...}). */
  categoryIds?: string[];
  branchIds?: string[];
  vendors?: string[];
  /** Keyword over line-item description + vendor (the "น้ำแข็ง" filter). */
  search?: string | null;
  grain: TimeGrain;
  /** Window length: months (grain=month) or years (grain=year). */
  span: number;
  /** Anchor month YYYY-MM (caller passes Bangkok current). */
  anchorPeriod: string;
  basis: AmountBasis;
}

export interface PivotRow {
  /** Dimension id (branch/category/createdBy) or the vendor string, or "none". */
  key: string;
  label: string;
  /** Aligned to `periods` (same length). */
  cells: number[];
  rowTotal: number;
  /** Last period vs the previous period, % change (mobile Δ%). null = no baseline. */
  deltaPct: number | null;
}

export interface PivotResult {
  /** Column headers oldest→newest. YYYY-MM (month grain) or YYYY (year grain). */
  periods: string[];
  rows: PivotRow[];
  /** Per-period column totals, aligned to `periods`. */
  columnTotals: number[];
  grandTotal: number;
  basis: AmountBasis;
  grain: TimeGrain;
  /** true if the read hit READ_CAP (numbers may be incomplete — warn the user). */
  truncated: boolean;
}

function monthPeriod(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function yearPeriod(d: Date): string {
  return String(d.getUTCFullYear());
}
function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Build the oldest→newest column list + the UTC lower bound for the query. */
function buildPeriods(
  grain: TimeGrain,
  span: number,
  anchorPeriod: string,
): { periods: string[]; start: Date } {
  if (grain === "year") {
    const anchorYear = Number(anchorPeriod.slice(0, 4));
    const periods: string[] = [];
    for (let i = span - 1; i >= 0; i--) periods.push(String(anchorYear - i));
    const start = new Date(Date.UTC(anchorYear - span + 1, 0, 1));
    return { periods, start };
  }
  const periods: string[] = [];
  for (let i = span - 1; i >= 0; i--) periods.push(shiftMonth(anchorPeriod, -i));
  const [sy, sm] = periods[0].split("-").map(Number);
  return { periods, start: new Date(Date.UTC(sy, sm - 1, 1)) };
}

/**
 * Faceted spend pivot — rows = chosen axis, columns = months/years, cells = ยอด.
 * Always org+company scoped + actor-branch-narrowed + confirmed/locked + non-
 * superseded. Returns rows sorted by rowTotal desc ("ไม่ระบุ" last).
 */
export async function spendPivot(input: PivotInput): Promise<PivotResult> {
  const {
    orgId, companyId, actorScope, rowAxis, categoryIds, vendors, search,
    grain, span, anchorPeriod, basis,
  } = input;

  const { periods, start } = buildPeriods(grain, span, anchorPeriod);
  const periodIndex = new Map(periods.map((p, i) => [p, i]));
  const empty: PivotResult = {
    periods, rows: [], columnTotals: periods.map(() => 0),
    grandTotal: 0, basis, grain, truncated: false,
  };

  const where: Prisma.LedgerExpenseWhereInput = {
    orgId,
    companyId,
    status: { in: [...SPEND_STATUS] },
    replacedById: null, // exclude superseded (quotation→real invoice) — no double count
    docDate: { gte: start },
  };
  if (categoryIds && categoryIds.length) where.categoryId = { in: categoryIds };
  if (vendors && vendors.length) where.vendor = { in: vendors };

  // Branch scope: an explicit branch filter must still respect the actor's reach;
  // a scoped member with no reachable branch gets an empty pivot (never a leak).
  const branchFilter = resolveBranchFilter(input.branchIds ?? [], actorScope);
  if (branchFilter === "deny") return empty;
  if (branchFilter !== null) where.branchId = branchFilter;

  // Keyword: matches the line-item description (where "น้ำแข็ง" lives) OR vendor.
  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { vendor: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { items: { some: { description: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const rows = await prisma.ledgerExpense.findMany({
    where,
    select: {
      branchId: true,
      categoryId: true,
      vendor: true,
      createdBy: true,
      docDate: true,
      subtotal: true,
      total: true,
    },
    take: READ_CAP + 1,
  });
  const truncated = rows.length > READ_CAP;
  const data = truncated ? rows.slice(0, READ_CAP) : rows;

  // Bucket: dimKey → (periodIndex → sum).
  const byKey = new Map<string, number[]>();
  const columnTotals = periods.map(() => 0);
  let grandTotal = 0;

  for (const r of data) {
    if (!r.docDate) continue;
    const period = grain === "year" ? yearPeriod(r.docDate) : monthPeriod(r.docDate);
    const ci = periodIndex.get(period);
    if (ci === undefined) continue; // outside the window
    const amt = basis === "net" ? dec(r.subtotal) : dec(r.total);
    const key = axisKey(rowAxis, r);
    let cells = byKey.get(key);
    if (!cells) {
      cells = periods.map(() => 0);
      byKey.set(key, cells);
    }
    cells[ci] += amt;
    columnTotals[ci] += amt;
    grandTotal += amt;
  }

  if (byKey.size === 0) return { ...empty, truncated };

  const labels = await resolveLabels(rowAxis, [...byKey.keys()], orgId, companyId);

  const pivotRows: PivotRow[] = [...byKey.entries()].map(([key, cells]) => {
    const rowTotal = cells.reduce((a, b) => a + b, 0);
    return { key, label: labels.get(key) ?? "ไม่ระบุ", cells, rowTotal, deltaPct: deltaPct(cells) };
  });

  // Sort by spend desc; the "ไม่ระบุ" bucket always sorts last.
  pivotRows.sort((a, b) => {
    if (a.key === "none" && b.key !== "none") return 1;
    if (b.key === "none" && a.key !== "none") return -1;
    return b.rowTotal - a.rowTotal;
  });

  return { periods, rows: pivotRows, columnTotals, grandTotal, basis, grain, truncated };
}

/** Last column vs the previous column (% change). null when no prior baseline. */
function deltaPct(cells: number[]): number | null {
  if (cells.length < 2) return null;
  const last = cells[cells.length - 1];
  const prev = cells[cells.length - 2];
  if (prev === 0) return null; // no baseline to compare against
  return ((last - prev) / prev) * 100;
}

type AxisRow = {
  branchId: string | null;
  categoryId: string | null;
  vendor: string | null;
  createdBy: string | null;
};
function axisKey(axis: RowAxis, r: AxisRow): string {
  const v =
    axis === "branch" ? r.branchId
      : axis === "category" ? r.categoryId
        : axis === "vendor" ? (r.vendor && r.vendor.trim() ? r.vendor.trim() : null)
          : r.createdBy;
  return v ?? "none";
}

/** Resolve dim keys → human labels (one round-trip per axis). */
async function resolveLabels(
  axis: RowAxis,
  keys: string[],
  orgId: string,
  companyId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const real = keys.filter((k) => k !== "none");

  if (axis === "vendor") {
    for (const k of keys) map.set(k, k === "none" ? "ไม่ระบุผู้ขาย" : k);
    return map;
  }
  map.set("none", axis === "branch" ? "ไม่ระบุสาขา" : axis === "category" ? "ไม่ระบุหมวด" : "ระบบ/ไม่ระบุ");
  if (real.length === 0) return map;

  if (axis === "branch") {
    const branches = await prisma.branch.findMany({
      where: { id: { in: real }, orgId, companyId },
      select: { id: true, name: true },
    });
    for (const b of branches) map.set(b.id, b.name);
  } else if (axis === "category") {
    const cats = await prisma.ledgerCategory.findMany({
      where: { id: { in: real }, orgId, companyId },
      select: { id: true, name: true },
    });
    for (const c of cats) map.set(c.id, c.name);
  } else {
    // person = createdBy (Pool user id). Resolve via User.name, then fall back to
    // the LINE member displayName for LINE-ingested rows, then "ระบบ/ไม่ระบุ".
    const users = await prisma.user.findMany({
      where: { id: { in: real } },
      select: { id: true, name: true },
    });
    for (const u of users) if (u.name) map.set(u.id, u.name);
    const unresolved = real.filter((k) => !map.has(k));
    if (unresolved.length > 0) {
      const members = await prisma.ledgerLineMember.findMany({
        where: { orgId, companyId, poolUserId: { in: unresolved } },
        select: { poolUserId: true, displayName: true },
      });
      for (const m of members) {
        if (m.poolUserId && m.displayName && !map.has(m.poolUserId)) {
          map.set(m.poolUserId, m.displayName);
        }
      }
    }
  }

  // Any key still unresolved (deleted/foreign) → labelled, never blank.
  for (const k of real) if (!map.has(k)) map.set(k, axis === "person" ? "ระบบ/ไม่ระบุ" : "ไม่ระบุ");
  return map;
}

/**
 * Branch where-clause honouring the actor's reach (multi-select aware).
 *   • admin/accountant (allBranches): the ticked branches as-is (or none = all).
 *   • scoped member: intersect the ticked branches with their reach; if they tick
 *     none → their whole reach; if the intersection is empty → "deny" (never a leak).
 */
function resolveBranchFilter(
  filterBranchIds: string[],
  actorScope: AnalyticsActorScope,
): Prisma.StringNullableFilter | "deny" | null {
  const ticked = filterBranchIds.filter((b) => b && b.trim());
  if (actorScope.allBranches) {
    return ticked.length ? { in: ticked } : null;
  }
  if (actorScope.scopeBranchIds.length === 0) return "deny";
  if (ticked.length) {
    const allowed = ticked.filter((b) => actorScope.scopeBranchIds.includes(b));
    return allowed.length ? { in: allowed } : "deny";
  }
  return { in: actorScope.scopeBranchIds };
}

// ---------------------------------------------------------------------------
// Keyword search — "ล่าสุดซื้อ X กี่บาท" + ประวัติสินค้า (branch-filterable).
// ---------------------------------------------------------------------------

export interface PurchaseHit {
  id: string;
  docCode: string;
  vendor: string | null;
  branchId: string | null;
  branchName: string | null;
  docDate: string | null;
  /** Amount in the chosen basis (net=subtotal / gross=total). */
  amount: number;
  /** The matching line item (description + unit price) when one matched. */
  itemDescription: string | null;
  itemUnitPrice: number | null;
}

/** Per-vendor price summary for the SAME item — "ใครขายถูกสุด". */
export interface VendorPriceCompare {
  vendor: string;
  /** Unit price of this vendor's most recent matching purchase. */
  latestUnitPrice: number | null;
  /** Lowest unit price this vendor ever charged for the item. */
  minUnitPrice: number | null;
  lastDate: string | null;
  count: number;
}

export interface PurchaseSearchResult {
  term: string;
  hits: PurchaseHit[];
  /** Monthly totals of the matched set, oldest→newest, for a mini trend. */
  trend: { period: string; total: number }[];
  /** Same item across vendors, cheapest min-price first. */
  vendorCompare: VendorPriceCompare[];
  truncated: boolean;
}

export interface PurchaseSearchInput {
  orgId: string;
  companyId: string;
  actorScope: AnalyticsActorScope;
  term: string;
  branchIds?: string[];
  basis: AmountBasis;
  /** Max hits to list (default 12). */
  limit?: number;
}

/**
 * Find the most recent purchases matching a keyword (line-item description OR
 * vendor OR note), branch-filterable. Returns the last `limit` buys with their
 * per-unit price + a monthly trend of the whole matched set.
 */
export async function searchPurchases(
  input: PurchaseSearchInput,
): Promise<PurchaseSearchResult> {
  const { orgId, companyId, actorScope, basis } = input;
  const term = input.term.trim();
  const limit = input.limit ?? 12;
  const empty: PurchaseSearchResult = {
    term,
    hits: [],
    trend: [],
    vendorCompare: [],
    truncated: false,
  };
  if (!term) return empty;

  const where: Prisma.LedgerExpenseWhereInput = {
    orgId,
    companyId,
    status: { in: [...SPEND_STATUS] },
    replacedById: null,
    OR: [
      { vendor: { contains: term, mode: "insensitive" } },
      { note: { contains: term, mode: "insensitive" } },
      { items: { some: { description: { contains: term, mode: "insensitive" } } } },
    ],
  };
  const branchFilter = resolveBranchFilter(input.branchIds ?? [], actorScope);
  if (branchFilter === "deny") return empty;
  if (branchFilter !== null) where.branchId = branchFilter;

  // Read enough to build a fair trend; list only the newest `limit`.
  const rows = await prisma.ledgerExpense.findMany({
    where,
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    take: READ_CAP + 1,
    select: {
      id: true,
      docCode: true,
      vendor: true,
      branchId: true,
      docDate: true,
      subtotal: true,
      total: true,
      items: {
        where: { description: { contains: term, mode: "insensitive" } },
        select: { description: true, unitPrice: true },
        take: 1,
      },
    },
  });
  const truncated = rows.length > READ_CAP;
  const data = truncated ? rows.slice(0, READ_CAP) : rows;

  // Branch names for the listed hits.
  const branchIds = new Set<string>();
  for (const r of data.slice(0, limit)) if (r.branchId) branchIds.add(r.branchId);
  const branches =
    branchIds.size > 0
      ? await prisma.branch.findMany({
          where: { id: { in: [...branchIds] }, orgId, companyId },
          select: { id: true, name: true },
        })
      : [];
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const hits: PurchaseHit[] = data.slice(0, limit).map((r) => {
    const it = r.items[0] ?? null;
    return {
      id: r.id,
      docCode: r.docCode,
      vendor: r.vendor,
      branchId: r.branchId,
      branchName: r.branchId ? branchName.get(r.branchId) ?? null : null,
      docDate: r.docDate ? r.docDate.toISOString().slice(0, 10) : null,
      amount: basis === "net" ? dec(r.subtotal) : dec(r.total),
      itemDescription: it?.description ?? null,
      itemUnitPrice: it ? dec(it.unitPrice) : null,
    };
  });

  // Monthly trend across the whole matched set (oldest→newest).
  const byPeriod = new Map<string, number>();
  for (const r of data) {
    if (!r.docDate) continue;
    const p = monthPeriod(r.docDate);
    byPeriod.set(p, (byPeriod.get(p) ?? 0) + (basis === "net" ? dec(r.subtotal) : dec(r.total)));
  }
  const trend = [...byPeriod.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([period, total]) => ({ period, total }));

  // Cross-vendor compare: group the matched line item's unit price by vendor.
  // `data` is ordered docDate desc → the first row seen per vendor is its latest.
  const vmap = new Map<
    string,
    { latest: number | null; min: number; lastDate: string | null; count: number }
  >();
  for (const r of data) {
    const it = r.items[0];
    if (!it || it.unitPrice == null) continue;
    const price = dec(it.unitPrice);
    if (!(price > 0)) continue;
    const vendor = r.vendor?.trim() || "ไม่ระบุผู้ขาย";
    const date = r.docDate ? r.docDate.toISOString().slice(0, 10) : null;
    const cur = vmap.get(vendor) ?? { latest: null, min: price, lastDate: null, count: 0 };
    cur.count += 1;
    cur.min = Math.min(cur.min, price);
    if (cur.latest === null) {
      cur.latest = price;
      cur.lastDate = date;
    }
    vmap.set(vendor, cur);
  }
  const vendorCompare: VendorPriceCompare[] = [...vmap.entries()]
    .map(([vendor, v]) => ({
      vendor,
      latestUnitPrice: v.latest,
      minUnitPrice: v.min,
      lastDate: v.lastDate,
      count: v.count,
    }))
    .sort((a, b) => (a.minUnitPrice ?? Infinity) - (b.minUnitPrice ?? Infinity));

  return { term, hits, trend, vendorCompare, truncated };
}

// ---------------------------------------------------------------------------
// Vendor options for the multi-select tick filter.
// ---------------------------------------------------------------------------

export interface VendorOption {
  vendor: string;
  total: number;
}

/**
 * Distinct vendors that actually appear in this company's confirmed spend
 * (actor-branch-narrowed), ranked by total so the most-used sit on top of the
 * tick list. Capped at `limit` (default 60) — the picker has its own search box
 * for the long tail. Real spend only (confirmed+locked, non-superseded).
 */
export async function listTopVendors(input: {
  orgId: string;
  companyId: string;
  actorScope: AnalyticsActorScope;
  limit?: number;
}): Promise<VendorOption[]> {
  const { orgId, companyId, actorScope } = input;
  const limit = input.limit ?? 60;

  const where: Prisma.LedgerExpenseWhereInput = {
    orgId,
    companyId,
    status: { in: [...SPEND_STATUS] },
    replacedById: null,
    vendor: { not: null },
  };
  const branchFilter = resolveBranchFilter([], actorScope);
  if (branchFilter === "deny") return [];
  if (branchFilter !== null) where.branchId = branchFilter;

  const rows = await prisma.ledgerExpense.findMany({
    where,
    select: { vendor: true, subtotal: true },
    take: READ_CAP + 1,
  });
  const data = rows.length > READ_CAP ? rows.slice(0, READ_CAP) : rows;

  const byVendor = new Map<string, number>();
  for (const r of data) {
    const v = r.vendor?.trim();
    if (!v) continue;
    byVendor.set(v, (byVendor.get(v) ?? 0) + dec(r.subtotal));
  }
  return [...byVendor.entries()]
    .map(([vendor, total]) => ({ vendor, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
