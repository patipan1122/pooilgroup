// LedgerLine — read-side queries.
//
// All reads are tenant-scoped: org_id (always) + company_id + optional branch_id.
// RLS (current_org_id()) is the backstop, but we ALSO filter by org_id in every
// query so a bug can't silently widen scope (defence in depth — same as other
// modules after the cross-org-leak audits).
//
// Per-request lookups are wrapped in React cache() so layout + page + nested
// server components share one round-trip per render.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  Expense,
  ExpenseAttachment,
  ExpenseDocType,
  ExpenseItem,
  ExpenseStatus,
  FieldConfidence,
  PaymentStatus,
} from "./types";

/** Coerce the jsonb attachments column → typed array (tolerant of bad rows). */
function attachmentsOf(v: unknown): ExpenseAttachment[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (a): a is ExpenseAttachment =>
      !!a && typeof a === "object" && typeof (a as ExpenseAttachment).url === "string",
  );
}

/** Coerce the jsonb completeness_missing column → string[] | null (tolerant). */
function missingOf(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((s): s is string => typeof s === "string");
}

// ---- Decimal/Date serialization (RSC-safe) ----
type DecimalLike = { toNumber: () => number } | number | null | undefined;

function dec(v: DecimalLike): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type ExpenseRow = Prisma.LedgerExpenseGetPayload<{
  include: { items: true; category: { select: { name: true } } };
}>;

function serializeItem(it: ExpenseRow["items"][number]): ExpenseItem {
  return {
    id: it.id,
    description: it.description,
    qty: dec(it.qty),
    unitPrice: dec(it.unitPrice),
    amount: dec(it.amount),
    vatRate: it.vatRate == null ? null : dec(it.vatRate),
  };
}

export function serializeExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    orgId: row.orgId,
    companyId: row.companyId,
    branchId: row.branchId,
    docCode: row.docCode,
    status: row.status as ExpenseStatus,
    source: row.source as Expense["source"],
    vendor: row.vendor,
    vendorTaxId: row.vendorTaxId,
    docDate: isoDate(row.docDate),
    subtotal: dec(row.subtotal),
    vat: dec(row.vat),
    wht: dec(row.wht),
    total: dec(row.total),
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    paymentMethod: row.paymentMethod,
    docType: (row.docType as ExpenseDocType) ?? "tax_invoice",
    vendorDocNumber: row.vendorDocNumber,
    vendorAddress: row.vendorAddress,
    vendorBranchCode: row.vendorBranchCode,
    discount: dec(row.discount),
    paymentStatus: (row.paymentStatus as PaymentStatus) ?? "paid",
    claimantName: row.claimantName,
    bankDetail: row.bankDetail,
    isRecurring: row.isRecurring,
    attachments: attachmentsOf(row.attachments),
    driveWebUrl: row.driveWebUrl,
    originalUrl: row.originalUrl,
    thumbUrl: row.thumbUrl,
    sha256: row.sha256,
    ocrModel: row.ocrModel,
    ocrConfidence: (row.ocrConfidence as FieldConfidence | null) ?? null,
    slipRef: row.slipRef,
    needsReview: row.needsReview,
    note: row.note,
    createdBy: row.createdBy,
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
    exportBatchId: row.exportBatchId,
    trcloudDocId: row.trcloudDocId,
    trcloudDocNo: row.trcloudDocNo,
    trcloudPushedAt: iso(row.trcloudPushedAt),
    trcloudError: row.trcloudError,
    // — Input-VAT claimability (ภาษีซื้อ) —
    buyerTaxIdSnapshot: row.buyerTaxIdSnapshot,
    buyerNameSnapshot: row.buyerNameSnapshot,
    buyerTaxIdOnDoc: row.buyerTaxIdOnDoc,
    buyerMatchStatus: (row.buyerMatchStatus as Expense["buyerMatchStatus"]) ?? "undecided",
    completenessStatus: (row.completenessStatus as Expense["completenessStatus"]) ?? "undecided",
    completenessMissing: missingOf(row.completenessMissing),
    completenessCheckedAt: iso(row.completenessCheckedAt),
    inputVatClaimable: row.inputVatClaimable,
    inputVatBlockReason: (row.inputVatBlockReason as Expense["inputVatBlockReason"]) ?? null,
    replacementOfId: row.replacementOfId,
    replacedById: row.replacedById,
    overrideBy: row.overrideBy,
    overrideAt: iso(row.overrideAt),
    overrideReason: row.overrideReason,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    items: row.items.map(serializeItem),
  };
}

const EXPENSE_INCLUDE = {
  items: true,
  category: { select: { name: true } },
} satisfies Prisma.LedgerExpenseInclude;

export interface ExpenseListFilter {
  orgId: string;
  companyId: string;
  branchId?: string | null;
  status?: ExpenseStatus | ExpenseStatus[];
  categoryId?: string | null;
  /** YYYY-MM — filter by doc month. */
  period?: string | null;
  needsReview?: boolean;
  /** true = ส่ง TRCloud แล้ว · false = ยังไม่ส่ง · undefined = ทั้งหมด */
  trcloudPushed?: boolean;
  /** filter ตามสถานะสีภาษีซื้อ: green=ขอคืนได้ · yellow=ขอใบใหม่ · red=ขอคืนไม่ได้. */
  completeness?: "green" | "yellow" | "red";
  search?: string | null;
  take?: number;
  skip?: number;
}

/** Map a color filter token → the completeness_status column value. */
const COMPLETENESS_STATUS_BY_FILTER = {
  green: "green_full",
  yellow: "yellow_partial",
  red: "red_invalid",
} as const;

function buildWhere(f: ExpenseListFilter): Prisma.LedgerExpenseWhereInput {
  const where: Prisma.LedgerExpenseWhereInput = {
    orgId: f.orgId,
    companyId: f.companyId,
  };
  if (f.branchId !== undefined && f.branchId !== null) where.branchId = f.branchId;
  if (f.status) {
    where.status = Array.isArray(f.status) ? { in: f.status } : f.status;
  }
  if (f.categoryId) where.categoryId = f.categoryId;
  if (f.needsReview !== undefined) where.needsReview = f.needsReview;
  if (f.trcloudPushed !== undefined) {
    where.trcloudDocId = f.trcloudPushed ? { not: null } : null;
  }
  if (f.completeness) {
    where.completenessStatus = COMPLETENESS_STATUS_BY_FILTER[f.completeness];
  }
  if (f.period) {
    const [y, m] = f.period.split("-").map(Number);
    if (y && m) {
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      where.docDate = { gte: start, lt: end };
    }
  }
  if (f.search) {
    where.OR = [
      { vendor: { contains: f.search, mode: "insensitive" } },
      { docCode: { contains: f.search, mode: "insensitive" } },
      { vendorTaxId: { contains: f.search } },
    ];
  }
  return where;
}

/** List expenses (newest first). Always org+company scoped. */
export async function listExpenses(f: ExpenseListFilter): Promise<Expense[]> {
  const rows = await prisma.ledgerExpense.findMany({
    where: buildWhere(f),
    include: EXPENSE_INCLUDE,
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    take: f.take ?? 100,
    skip: f.skip ?? 0,
  });
  return rows.map(serializeExpense);
}

export async function countExpenses(f: ExpenseListFilter): Promise<number> {
  return prisma.ledgerExpense.count({ where: buildWhere(f) });
}

// ---- List summary (perf) ----
// The รายจ่าย left-pane list + home drafts list render only summary fields and
// never read `items`. listExpenses() joins every line-item + all columns for up
// to 300 rows → big over-fetch (N item rows joined/serialized/streamed each nav).
// This variant selects only the columns the list UI uses and skips the items
// join. Returned shape is still the full `Expense` (items: []) so the UI type
// contract (ExpenseRow = Expense) is unchanged — the list never touches items.
const EXPENSE_SUMMARY_SELECT = {
  id: true,
  orgId: true,
  companyId: true,
  branchId: true,
  docCode: true,
  status: true,
  source: true,
  vendor: true,
  vendorTaxId: true,
  docDate: true,
  subtotal: true,
  vat: true,
  wht: true,
  total: true,
  categoryId: true,
  paymentMethod: true,
  docType: true,
  vendorDocNumber: true,
  discount: true,
  paymentStatus: true,
  claimantName: true,
  isRecurring: true,
  driveWebUrl: true,
  originalUrl: true,
  thumbUrl: true,
  sha256: true,
  ocrModel: true,
  ocrConfidence: true,
  slipRef: true,
  needsReview: true,
  note: true,
  createdBy: true,
  confirmedBy: true,
  confirmedAt: true,
  exportBatchId: true,
  trcloudDocId: true,
  trcloudDocNo: true,
  trcloudPushedAt: true,
  trcloudError: true,
  // — Input-VAT claimability (ภาษีซื้อ) — the list dots + claimable filter read these —
  buyerTaxIdSnapshot: true,
  buyerNameSnapshot: true,
  buyerTaxIdOnDoc: true,
  buyerMatchStatus: true,
  completenessStatus: true,
  completenessMissing: true,
  completenessCheckedAt: true,
  inputVatClaimable: true,
  inputVatBlockReason: true,
  replacementOfId: true,
  replacedById: true,
  overrideBy: true,
  overrideAt: true,
  overrideReason: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { name: true } },
} satisfies Prisma.LedgerExpenseSelect;

type ExpenseSummaryRow = Prisma.LedgerExpenseGetPayload<{
  select: typeof EXPENSE_SUMMARY_SELECT;
}>;

function serializeExpenseSummary(row: ExpenseSummaryRow): Expense {
  return {
    id: row.id,
    orgId: row.orgId,
    companyId: row.companyId,
    branchId: row.branchId,
    docCode: row.docCode,
    status: row.status as ExpenseStatus,
    source: row.source as Expense["source"],
    vendor: row.vendor,
    vendorTaxId: row.vendorTaxId,
    docDate: isoDate(row.docDate),
    subtotal: dec(row.subtotal),
    vat: dec(row.vat),
    wht: dec(row.wht),
    total: dec(row.total),
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    paymentMethod: row.paymentMethod,
    docType: (row.docType as ExpenseDocType) ?? "tax_invoice",
    vendorDocNumber: row.vendorDocNumber,
    vendorAddress: null, // not needed in the list — skipped
    vendorBranchCode: null,
    discount: dec(row.discount),
    paymentStatus: (row.paymentStatus as PaymentStatus) ?? "paid",
    claimantName: row.claimantName,
    bankDetail: null,
    isRecurring: row.isRecurring,
    attachments: [], // not needed in the list — skipped
    driveWebUrl: row.driveWebUrl,
    originalUrl: row.originalUrl,
    thumbUrl: row.thumbUrl,
    sha256: row.sha256,
    ocrModel: row.ocrModel,
    ocrConfidence: (row.ocrConfidence as FieldConfidence | null) ?? null,
    slipRef: row.slipRef,
    needsReview: row.needsReview,
    note: row.note,
    createdBy: row.createdBy,
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
    exportBatchId: row.exportBatchId,
    trcloudDocId: row.trcloudDocId,
    trcloudDocNo: row.trcloudDocNo,
    trcloudPushedAt: iso(row.trcloudPushedAt),
    trcloudError: row.trcloudError,
    // — Input-VAT claimability (ภาษีซื้อ) —
    buyerTaxIdSnapshot: row.buyerTaxIdSnapshot,
    buyerNameSnapshot: row.buyerNameSnapshot,
    buyerTaxIdOnDoc: row.buyerTaxIdOnDoc,
    buyerMatchStatus: (row.buyerMatchStatus as Expense["buyerMatchStatus"]) ?? "undecided",
    completenessStatus: (row.completenessStatus as Expense["completenessStatus"]) ?? "undecided",
    completenessMissing: missingOf(row.completenessMissing),
    completenessCheckedAt: iso(row.completenessCheckedAt),
    inputVatClaimable: row.inputVatClaimable,
    inputVatBlockReason: (row.inputVatBlockReason as Expense["inputVatBlockReason"]) ?? null,
    replacementOfId: row.replacementOfId,
    replacedById: row.replacedById,
    overrideBy: row.overrideBy,
    overrideAt: iso(row.overrideAt),
    overrideReason: row.overrideReason,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    items: [], // list UI never reads items — skipped to avoid the join
  };
}

/**
 * List expenses for the summary list UI (newest first). Same scoping/filtering
 * as listExpenses() but WITHOUT the line-item join — use for the list pane /
 * home drafts where `items` is never rendered. Use listExpenses() (full include)
 * for the detail pane / exports that need line items.
 */
export async function listExpensesSummary(f: ExpenseListFilter): Promise<Expense[]> {
  const rows = await prisma.ledgerExpense.findMany({
    where: buildWhere(f),
    select: EXPENSE_SUMMARY_SELECT,
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    take: f.take ?? 100,
    skip: f.skip ?? 0,
  });
  return rows.map(serializeExpenseSummary);
}

/** Single expense — org+company scoped (returns null if not in tenant). */
export async function getExpense(opts: {
  orgId: string;
  companyId: string;
  id: string;
}): Promise<Expense | null> {
  const row = await prisma.ledgerExpense.findFirst({
    where: { id: opts.id, orgId: opts.orgId, companyId: opts.companyId },
    include: EXPENSE_INCLUDE,
  });
  return row ? serializeExpense(row) : null;
}

/** Dedup lookup by sha256 within a tenant — used before creating a draft. */
export async function findExpenseBySha(opts: {
  orgId: string;
  companyId: string;
  sha256: string;
}): Promise<{ id: string; docCode: string } | null> {
  const row = await prisma.ledgerExpense.findFirst({
    where: { orgId: opts.orgId, companyId: opts.companyId, sha256: opts.sha256 },
    select: { id: true, docCode: true },
  });
  return row;
}

/** Active expense categories for a company (org+company scoped). cache()d. */
export const listCategories = cache(
  async (orgId: string, companyId: string) => {
    return prisma.ledgerCategory.findMany({
      where: { orgId, companyId, active: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true, trcloudAccCode: true, sort: true },
    });
  },
);

/** Companies in the org (for the company picker). cache()d. */
export const listCompanies = cache(async (orgId: string) => {
  return prisma.company.findMany({
    where: { orgId, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
});

/** Branches of a company (for the branch picker). cache()d. */
export const listBranches = cache(async (orgId: string, companyId: string) => {
  return prisma.branch.findMany({
    where: { orgId, companyId, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
});

export interface CategorySpendRow {
  categoryId: string | null;
  categoryName: string | null;
  total: number;
  count: number;
}

/**
 * Spend grouped by category for a company/period (confirmed+locked only —
 * drafts are not real spend yet). Used by the dashboard + budget alerts.
 */
export async function spendByCategory(opts: {
  orgId: string;
  companyId: string;
  branchId?: string | null;
  period?: string | null;
}): Promise<CategorySpendRow[]> {
  const where = buildWhere({
    orgId: opts.orgId,
    companyId: opts.companyId,
    branchId: opts.branchId ?? undefined,
    period: opts.period ?? undefined,
    status: ["confirmed", "locked"],
  });

  const grouped = await prisma.ledgerExpense.groupBy({
    by: ["categoryId"],
    where,
    _sum: { total: true },
    _count: { _all: true },
  });

  // Resolve category names in one round-trip.
  const ids = grouped
    .map((g) => g.categoryId)
    .filter((id): id is string => !!id);
  const cats =
    ids.length > 0
      ? await prisma.ledgerCategory.findMany({
          where: { id: { in: ids }, orgId: opts.orgId },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(cats.map((c) => [c.id, c.name]));

  return grouped.map((g) => ({
    categoryId: g.categoryId,
    categoryName: g.categoryId ? nameById.get(g.categoryId) ?? null : null,
    total: dec(g._sum.total),
    count: g._count._all,
  }));
}

// ---- Completeness summary (สถานะสีภาษีซื้อ) ----
export interface CompletenessSummary {
  /** count per สถานะสี (รวม undecided ที่ยังไม่ตรวจ). */
  counts: {
    green_full: number;
    yellow_partial: number;
    red_invalid: number;
    undecided: number;
  };
  /** ยอด VAT ที่ยัง "ติด" (claimable = false หรือ null) — ภาษีซื้อที่ยังกู้ไม่ได้. */
  blockedVat: number;
}

/**
 * Summarize the color-status mix for the summary strip: count per completeness
 * status + the total VAT still blocked (claimable=false OR null). Same scoping/
 * filtering as listExpenses (org+company [+branch/period/...]) so the strip matches
 * whatever the list is showing. groupBy mirrors spendByCategory's pattern.
 */
export async function summarizeCompleteness(
  f: ExpenseListFilter,
): Promise<CompletenessSummary> {
  const where = buildWhere(f);

  const [grouped, blocked] = await Promise.all([
    prisma.ledgerExpense.groupBy({
      by: ["completenessStatus"],
      where,
      _count: { _all: true },
    }),
    prisma.ledgerExpense.aggregate({
      where: { ...where, OR: [{ inputVatClaimable: false }, { inputVatClaimable: null }] },
      _sum: { vat: true },
    }),
  ]);

  const counts = {
    green_full: 0,
    yellow_partial: 0,
    red_invalid: 0,
    undecided: 0,
  };
  for (const g of grouped) {
    const key = g.completenessStatus as keyof typeof counts;
    if (key in counts) counts[key] = g._count._all;
  }

  return { counts, blockedVat: dec(blocked._sum.vat) };
}
