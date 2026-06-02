// LedgerLine — export confirmed expenses INTO TRCloud (the book of record).
//
// LedgerLine COMPLEMENTS TRCloud (does not replace it): we capture + classify
// here, then push confirmed AP entries into TRCloud. Phase 1 ships a CSV export
// (column shape pending the TRCloud import template the CEO must supply); the
// TRCloud create-AP API is Phase 2.
//
// TODO[ledger-secret]: confirm TRCloud CSV import columns + (Phase 2) API token.

import type { Expense } from "./types";

/** One row in the TRCloud-bound CSV. Column names are PROVISIONAL — must be
 *  reconciled against TRCloud's real import template (see docs/LEDGER_SETUP.md). */
export interface TrcloudExportRow {
  doc_code: string;
  doc_date: string; // YYYY-MM-DD
  vendor: string;
  vendor_tax_id: string;
  acc_code: string; // category.trcloud_acc_code
  subtotal: number;
  vat: number;
  wht: number;
  total: number;
  note: string;
}

export interface TrcloudExportResult {
  format: "csv";
  rows: number;
  csv: string;
}

const HEADERS: (keyof TrcloudExportRow)[] = [
  "doc_code",
  "doc_date",
  "vendor",
  "vendor_tax_id",
  "acc_code",
  "subtotal",
  "vat",
  "wht",
  "total",
  "note",
];

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  // Quote when the cell contains a comma/quote/newline; double internal quotes.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Map confirmed expenses → a TRCloud-import CSV string. */
export function buildTrcloudCsv(
  expenses: Expense[],
  accCodeByCategory: Record<string, string | null> = {},
): TrcloudExportResult {
  const rows: TrcloudExportRow[] = expenses.map((e) => ({
    doc_code: e.docCode,
    doc_date: e.docDate ?? "",
    vendor: e.vendor ?? "",
    vendor_tax_id: e.vendorTaxId ?? "",
    acc_code: (e.categoryId ? accCodeByCategory[e.categoryId] : null) ?? "",
    subtotal: e.subtotal,
    vat: e.vat,
    wht: e.wht,
    total: e.total,
    note: e.note ?? "",
  }));

  const lines = [
    HEADERS.join(","),
    ...rows.map((r) => HEADERS.map((h) => csvCell(r[h])).join(",")),
  ];

  return { format: "csv", rows: rows.length, csv: lines.join("\n") };
}

/**
 * Phase 2: push directly to TRCloud via API.
 * TODO[ledger-secret]: implement once TRCloud create-AP endpoint + token exist.
 */
export async function pushToTrcloudApi(
  _expenses: Expense[],
): Promise<{ ok: false; reason: string }> {
  return { ok: false, reason: "TRCloud API export ยังไม่ได้ตั้งค่า (Phase 2)" };
}
