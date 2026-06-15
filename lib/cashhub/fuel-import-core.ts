// CashHub ⛽ ปั๊มน้ำมัน 62 — shared import core used by BOTH the preview (dry-run) and
// the commit route, so the diff the CEO confirms is exactly what gets written.
// Always parses SERVER-SIDE (fetch the public link OR an uploaded file); never trusts
// client-sent financial rows.

import { fetchFuelWorkbook, validateUploadedXlsx } from "./fuel-fetch";
import {
  parseFuelWorkbook,
  latestMonthKeys,
  type FuelShiftRow,
  type FuelParseResult,
} from "./fuel-parser";
import { classifyRows, type FuelRecon } from "./fuel-validator";
import * as XLSX from "xlsx";

export const PUMP_KEY = "pump62";
export const PUMP_LABEL = "ปั๊ม 62 หัวทะเล (วายเอ็มพลัส)";

export type ImportMode = "pull" | "upload";

export interface LoadedWorkbook {
  ok: true;
  buf: Buffer;
  fetchedAt: string | null; // set on pull, null on upload
  source: "ym62_sheet" | "upload";
}
export type LoadResult = LoadedWorkbook | { ok: false; reason: string };

/** Resolve the workbook bytes from a multipart request (pull = fetch link, upload = file). */
export async function loadWorkbook(
  mode: ImportMode,
  file: File | null,
): Promise<LoadResult> {
  if (mode === "upload") {
    if (!file) return { ok: false, reason: "ไม่พบไฟล์ที่อัป" };
    const buf = Buffer.from(await file.arrayBuffer());
    const v = validateUploadedXlsx(buf);
    if (!v.ok) return { ok: false, reason: v.reason ?? "ไฟล์ไม่ถูกต้อง" };
    return { ok: true, buf, fetchedAt: null, source: "upload" };
  }
  const res = await fetchFuelWorkbook();
  if (!res.ok) return res;
  return { ok: true, buf: res.buf, fetchedAt: res.fetchedAt, source: "ym62_sheet" };
}

export interface ClassifiedRow {
  row: FuelShiftRow;
  recon: FuelRecon;
}

export interface ParseOutcome extends FuelParseResult {
  classified: ClassifiedRow[];
}

/**
 * Parse + classify. `latest` restricts to the N most recent months present (so a routine
 * pull doesn't churn 30 tabs); pass 0 to parse every fuel tab.
 */
export function parseAndClassify(buf: Buffer, latest = 2): ParseOutcome {
  let onlyMonths: Set<string> | undefined;
  if (latest > 0) {
    const names = XLSX.read(buf, { type: "buffer", bookSheets: true }).SheetNames;
    onlyMonths = latestMonthKeys(names, latest);
  }
  const parsed = parseFuelWorkbook(buf, { onlyMonths });
  const recon = classifyRows(parsed.rows);
  const classified = parsed.rows.map((row, i) => ({ row, recon: recon[i]! }));
  return { ...parsed, classified };
}

/** DB payload (sans id/updated_at — withDbDefaults adds those). */
export function toDbRow(
  c: ClassifiedRow,
  ctx: { orgId: string; userId: string; fetchedAt: string | null; source: string },
) {
  const { row, recon } = c;
  return {
    org_id: ctx.orgId,
    pump_key: PUMP_KEY,
    branch_id: null,
    report_date: row.reportDate,
    shift: row.shift,
    sheet_tab: row.sheetTab,
    source: ctx.source,
    liters: row.liters,
    total_sales: row.totalSales,
    fuel_sales: row.fuelSales,
    engine_oil_sales: row.engineOilSales,
    cash_submitted: row.cashSubmitted,
    cash_banked: row.cashBanked,
    cash_diff_sheet: row.cashDiffSheet,
    cash_diff_calc: recon.cashDiffCalc,
    credit: row.credit,
    credit_diff: row.creditDiff,
    total_diff: row.totalDiff,
    transfer_total: row.transferTotal,
    card_total: row.cardTotal,
    grand_total_both: row.grandTotalBoth,
    measure_check: row.measure,
    staff_name: row.staffName,
    note: row.note,
    recon_status: recon.reconStatus,
    anomaly_codes: recon.anomalyCodes,
    bank_breakdown: {
      ttb_0649: row.ttb0649,
      kbank_2345: row.ksk2345,
      ttb_609: row.ttb609,
    },
    raw_row: { cells: row.rawRow },
    source_fetched_at: ctx.fetchedAt,
    imported_by_id: ctx.userId,
    imported_at: new Date().toISOString(),
  };
}

export const importKey = (date: string, shift: string) => `${date}|${shift}`;
