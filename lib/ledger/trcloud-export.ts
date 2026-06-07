// LedgerLine — export confirmed expenses INTO TRCloud (the book of record).
//
// LedgerLine COMPLEMENTS TRCloud (does not replace it): we capture + classify
// here, then push confirmed AP entries into TRCloud. This module ships a REAL
// CSV export now; the TRCloud create-AP API write-path stays a TODO[ledger-secret]
// stub until the CEO supplies the endpoint + token.
//
// EXPORT = confirmed + locked only (drafts never leave the building — GOLDEN
// RULE). Everything is org+company scoped.

import { prisma } from "@/lib/prisma";
import { listExpenses } from "./queries";
import type { Expense } from "./types";

/** One row in the TRCloud-bound CSV. Column names are PROVISIONAL — must be
 *  reconciled against TRCloud's real AP import template (docs/LEDGER_SETUP.md). */
export interface TrcloudExportRow {
  doc_code: string;
  doc_date: string; // YYYY-MM-DD
  vendor: string;
  tax_id: string;
  category: string; // category display name
  acc_code: string; // category.trcloud_acc_code (the TRCloud GL account)
  payment_method: string;
  subtotal: number;
  discount: number;
  vat: number;
  wht: number;
  total: number;
  note: string;
}

export interface TrcloudExportResult {
  format: "csv";
  rows: number;
  csv: string;
  /** Suggested download filename, e.g. ledger-trcloud-2026-06.csv */
  filename: string;
}

// Order = the TRCloud AP import column order (date, vendor, tax_id, subtotal,
// vat, total, category, doc_code) + the extras TRCloud also accepts. Adjust to
// match the real template; the data mapping stays the same.
const HEADERS: (keyof TrcloudExportRow)[] = [
  "doc_date",
  "doc_code",
  "vendor",
  "tax_id",
  "category",
  "acc_code",
  "payment_method",
  "subtotal",
  "discount",
  "vat",
  "wht",
  "total",
  "note",
];

const HEADER_TH: Record<keyof TrcloudExportRow, string> = {
  doc_date: "วันที่",
  doc_code: "เลขเอกสาร",
  vendor: "ผู้ขาย",
  tax_id: "เลขผู้เสียภาษี",
  category: "หมวด",
  acc_code: "รหัสบัญชี",
  payment_method: "วิธีชำระ",
  subtotal: "ยอดก่อนภาษี",
  discount: "ส่วนลด",
  vat: "ภาษีมูลค่าเพิ่ม",
  wht: "หัก ณ ที่จ่าย",
  total: "ยอดรวม",
  note: "หมายเหตุ",
};

function csvCell(v: string | number): string {
  const s = v == null ? "" : String(v);
  // Quote when the cell contains a comma/quote/newline; double internal quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(n: number): string {
  // Two-decimal fixed so TRCloud parses money consistently (no locale commas).
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

function toRow(
  e: Expense,
  accCodeByCategory: Record<string, string | null>,
): TrcloudExportRow {
  return {
    doc_code: e.docCode,
    doc_date: e.docDate ?? "",
    vendor: e.vendor ?? "",
    tax_id: e.vendorTaxId ?? "",
    category: e.categoryName ?? "",
    acc_code: (e.categoryId ? accCodeByCategory[e.categoryId] : null) ?? "",
    payment_method: e.paymentMethod ?? "",
    subtotal: e.subtotal,
    discount: e.discount ?? 0,
    vat: e.vat,
    wht: e.wht,
    total: e.total,
    note: e.note ?? "",
  };
}

/**
 * Map confirmed expenses → a TRCloud-import CSV string.
 *
 * @param thaiHeader  emit Thai column labels (default) vs the snake_case keys.
 * @param bom         prepend a UTF-8 BOM so Excel opens Thai text correctly
 *                    (default true — accountants open these in Excel).
 */
export function buildTrcloudCsv(
  expenses: Expense[],
  accCodeByCategory: Record<string, string | null> = {},
  opts: { thaiHeader?: boolean; bom?: boolean; period?: string } = {},
): TrcloudExportResult {
  const thaiHeader = opts.thaiHeader ?? true;
  const bom = opts.bom ?? true;

  const rows = expenses.map((e) => toRow(e, accCodeByCategory));

  const moneyKeys = new Set<keyof TrcloudExportRow>([
    "subtotal",
    "discount",
    "vat",
    "wht",
    "total",
  ]);

  const headerLine = HEADERS.map((h) =>
    csvCell(thaiHeader ? HEADER_TH[h] : h),
  ).join(",");

  const bodyLines = rows.map((r) =>
    HEADERS.map((h) =>
      csvCell(moneyKeys.has(h) ? num(r[h] as number) : (r[h] as string)),
    ).join(","),
  );

  const csv = (bom ? "﻿" : "") + [headerLine, ...bodyLines].join("\r\n");
  const filename = `ledger-trcloud-${opts.period ?? "export"}.csv`;

  return { format: "csv", rows: rows.length, csv, filename };
}

export interface ExportConfirmedOptions {
  orgId: string;
  companyId: string;
  branchId?: string | null;
  /** YYYY-MM — when set, only that doc-month is exported. */
  period?: string | null;
  /** include already-locked rows too (default true). */
  includeLocked?: boolean;
  thaiHeader?: boolean;
  bom?: boolean;
}

/**
 * High-level export: pull CONFIRMED (+ locked) expenses for a company/period,
 * resolve each category's TRCloud account code, and build the CSV. This is the
 * function the export API route + the export server action call.
 *
 * Drafts and void rows are NEVER exported.
 */
export async function exportConfirmedExpenses(
  opts: ExportConfirmedOptions,
): Promise<TrcloudExportResult> {
  const statuses = opts.includeLocked === false
    ? (["confirmed"] as const)
    : (["confirmed", "locked"] as const);

  const { expenses } = await listExpenses({
    orgId: opts.orgId,
    companyId: opts.companyId,
    branchId: opts.branchId ?? undefined,
    status: [...statuses],
    period: opts.period ?? undefined,
    take: 5000, // a month of AP for one company comfortably fits one batch
  });

  // Resolve TRCloud account codes for the categories present in this batch.
  const catIds = [
    ...new Set(
      expenses.map((e) => e.categoryId).filter((id): id is string => !!id),
    ),
  ];
  const accCodeByCategory: Record<string, string | null> = {};
  if (catIds.length > 0) {
    const cats = await prisma.ledgerCategory.findMany({
      where: { id: { in: catIds }, orgId: opts.orgId },
      select: { id: true, trcloudAccCode: true },
    });
    for (const c of cats) accCodeByCategory[c.id] = c.trcloudAccCode ?? null;
  }

  return buildTrcloudCsv(expenses, accCodeByCategory, {
    thaiHeader: opts.thaiHeader,
    bom: opts.bom,
    period: opts.period ?? undefined,
  });
}

/**
 * Phase 2: push directly to TRCloud via API.
 * TODO[ledger-secret]: implement once TRCloud create-AP endpoint + token exist.
 * Keep the CSV path as the working fallback until then.
 */
export async function pushToTrcloudApi(
  _expenses: Expense[],
): Promise<{ ok: false; reason: string }> {
  // TODO[ledger-secret]: POST each AP entry to TRCloud's create-AP endpoint with
  // the org's TRCloud API token (stored encrypted, like ledger_line_channel
  // secrets). Until configured, callers should use exportConfirmedExpenses (CSV).
  return { ok: false, reason: "TRCloud API export ยังไม่ได้ตั้งค่า (Phase 2)" };
}
