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
import type { Expense, ExpenseItem, ExpenseStatus, FieldConfidence } from "./types";

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
  search?: string | null;
  take?: number;
  skip?: number;
}

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
