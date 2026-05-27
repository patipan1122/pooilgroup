// StarThing POS XLSX parser
//
// CEO uploads monthly export from StarThing portal (vendor for ChairOps massage chairs).
// File shape: 20 Thai-headed columns · daily summary · 1 row per (chair × store × date).
// Schema documented in [[chairops-starthing-xlsx-schema-2026-05-27]] memory.
//
// This module is pure & side-effect-free (except `computeDiffBuckets` which reads Prisma).
// Used by `app/(admin)/chairops/pos-ingest/actions.ts` server action.
//
// Acceptance: XLSX-1 through XLSX-9 (PERSONA_QA §2 Wave 0).
// Idempotency: file SHA256 → `ChairopsPosImport.fileHash` unique-per-org.
// Branch resolve: exact-match `ChairopsBranch.name` first → list unknowns · NEVER auto-create
// (per `[[pool-csv-import-must-diff-before-write]]`).

import * as XLSX from "xlsx";
import { createHash } from "crypto";
import type { PrismaClient } from "@/lib/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row from the StarThing XLSX export · per (chair × store × date). */
export interface StarThingRow {
  /** YYYY-MM-DD (AD) · normalized from BE if needed */
  bizDate: string;
  /** Device ID e.g. "G0310409" */
  chairCode: string;
  /** Device type e.g. "เก้าอี้นวด" */
  deviceType: string;
  /** Machine label e.g. "NO.5" — often empty */
  machineNo: string | null;
  /** Device group e.g. "Default Group" */
  deviceGroup: string;
  /** Raw store name e.g. "robinsonกาญ (900)" — used to match ChairopsBranch.name */
  storeName: string;
  /** เต็มจำนวน — gross revenue total */
  grossTotal: number;
  /** ชำระเงินออนไลน์ — online payment amount */
  onlineTotal: number;
  /** จ่ายเงินสด — cash payment amount (THE money column · maid collect target) */
  cashTotal: number;
  /** จำนวนเงินที่เปลี่ยนแปลง — refund/change amount */
  changeAmount: number;
  /** จำนวนการชำระเงินออนไลน์ — online payment count */
  paymentCount: number;
  /** จำนวนเงินชำระอื่น ๆ — other payment amount */
  otherTotal: number;
  /** จำนวนหยอดเหรียญ — coin insert count */
  coinInsertCount: number;
  /** เหรียญออนไลน์ — online coin count */
  onlineCoin: number;
  /** จำนวนรอบที่เริ่ม — rounds started count */
  roundCount: number | null;
  /** จำนวนสินค้า — item count */
  itemCount: number;
  /** ชื่อของขวัญ — gift name */
  giftName: string | null;
  /** ค่าของขวัญ — gift value */
  giftValue: number;
  /** อัตราการให้ของขวัญ — gift rate */
  giftRate: number | null;
  /** ราคาต่อหน่วยของเหรียญของขวัญ — gift coin unit price */
  giftCoinUnit: number | null;
}

export interface StarThingParseResult {
  totalRows: number;
  parsedRows: StarThingRow[];
  errors: Array<{ row: number; message: string }>;
  /** Column headers as found in the sheet (for surfacing unknown columns to CEO) */
  columnSet: string[];
  /** Headers we expect but didn't find — useful for CEO debug */
  missingColumns: string[];
  /** Headers we found that we don't know about (vendor schema drift) — surfaced per DEVIL hidden-complexity #1 */
  unknownColumns: string[];
  sheetName: string;
  /** Unique storeName values found in the file */
  branchNames: Set<string>;
  dateRange: { from: string; to: string } | null;
  /** SHA256 of the file buffer · for idempotency (`ChairopsPosImport.fileHash`) */
  fileHash: string;
}

/** Per-(branch × bizDate) aggregate — what we write to ChairopsBranchDailyRevenue. */
export interface AggregatedDailyRow {
  bizDate: string;
  storeName: string;
  cashTotal: number;
  onlineTotal: number;
  otherTotal: number;
  grossTotal: number;
  paymentCount: number;
  coinInsertCount: number;
  roundCount: number;
}

export interface DiffBucket {
  /** (orgId, branchId, bizDate) absent in DB */
  newRows: AggregatedDailyRow[];
  /** exists in DB · same numbers */
  sameRows: AggregatedDailyRow[];
  /** exists in DB · different numbers */
  changedRows: Array<{
    existing: AggregatedDailyRow;
    incoming: AggregatedDailyRow;
  }>;
  /** storeName values with no exact `ChairopsBranch.name` match — CEO must resolve */
  unknownBranches: string[];
  /** storeName → branchId for matched branches */
  knownBranches: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB hard cap
const PREFERRED_SHEET_NAME = "ข้อมูลรายได้ (ตามกรอบเวลา)";

/** Canonical column keys → array of Thai header aliases as observed in StarThing exports. */
const COLUMN_ALIASES: Record<keyof StarThingRow, readonly string[]> = {
  bizDate: ["วันที่", "date"],
  chairCode: ["รหัสอุปกรณ์", "เลขเครื่อง", "เครื่อง"],
  deviceType: ["ประเภทอุปกรณ์"],
  machineNo: ["หมายเลขเครื่องจักร"],
  deviceGroup: ["การจัดกลุ่มอุปกรณ์"],
  storeName: ["ชื่อร้าน", "สาขา"],
  grossTotal: ["เต็มจำนวน", "รวม", "total"],
  onlineTotal: ["ชำระเงินออนไลน์", "ออนไลน์", "online"],
  cashTotal: ["จ่ายเงินสด", "เงินสด", "cash"],
  changeAmount: ["จำนวนเงินที่เปลี่ยนแปลง"],
  paymentCount: ["จำนวนการชำระเงินออนไลน์"],
  otherTotal: ["จำนวนเงินชำระอื่น ๆ", "จำนวนเงินชำระอื่นๆ"],
  coinInsertCount: ["จำนวนหยอดเหรียญ", "เหรียญ", "coin"],
  onlineCoin: ["เหรียญออนไลน์"],
  roundCount: ["จำนวนรอบที่เริ่ม"],
  itemCount: ["จำนวนสินค้า"],
  giftName: ["ชื่อของขวัญ"],
  giftValue: ["ค่าของขวัญ"],
  giftRate: ["อัตราการให้ของขวัญ"],
  giftCoinUnit: ["ราคาต่อหน่วยของเหรียญของขวัญ"],
} as const;

// Columns that MUST be present for the row to be usable (enforced inline in row loop):
//   bizDate · chairCode · storeName · cashTotal

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeaderIndex(rawHeader: string[]): {
  index: Partial<Record<keyof StarThingRow, number>>;
  unknownColumns: string[];
} {
  const index: Partial<Record<keyof StarThingRow, number>> = {};
  const matchedHeaders = new Set<string>();

  for (const [keyRaw, aliases] of Object.entries(COLUMN_ALIASES)) {
    const key = keyRaw as keyof StarThingRow;
    for (let i = 0; i < rawHeader.length; i++) {
      const h = (rawHeader[i] ?? "").trim();
      if (!h) continue;
      if (aliases.includes(h)) {
        if (index[key] === undefined) index[key] = i;
        matchedHeaders.add(h);
      }
    }
  }

  const unknownColumns: string[] = [];
  for (const h of rawHeader) {
    const trimmed = (h ?? "").trim();
    if (trimmed && !matchedHeaders.has(trimmed)) unknownColumns.push(trimmed);
  }
  return { index, unknownColumns };
}

/** Parse "550.0000" / "550" / 550 / null → number (NaN if unparseable). */
function parseNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  if (typeof v === "string") {
    const s = v.replace(/[,\s฿]/g, "").trim();
    if (s === "" || s === "-") return 0;
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  }
  return NaN;
}

function parseOptionalNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseNumber(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse date — supports:
 *   - JS Date (from `cellDates:true`)
 *   - "YYYY-MM-DD" AD or BE (BE auto-detected if year > 2400)
 *   - "DD/MM/YYYY" / "DD-MM-YYYY"
 * Returns YYYY-MM-DD AD or null.
 */
function parseDateLike(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return null;

  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    let year = Number(iso[1]);
    if (year > 2400) year -= 543; // BE → AD
    return `${String(year).padStart(4, "0")}-${iso[2]}-${iso[3]}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) {
      // "69" → 2569 BE → 2026 AD (heuristic: > 50 → 25xx BE)
      year = year > 50 ? 2500 + year - 543 : 2000 + year;
    } else if (year > 2400) {
      year -= 543;
    }
    return `${String(year).padStart(4, "0")}-${mm}-${dd}`;
  }

  return null;
}

function toStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function toOptStr(v: unknown): string | null {
  const s = toStr(v);
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// parseStarThingXlsx
// ---------------------------------------------------------------------------

export function parseStarThingXlsx(fileBuffer: Buffer): StarThingParseResult {
  if (fileBuffer.length > MAX_FILE_BYTES) {
    throw new Error(
      `ไฟล์ใหญ่เกิน 10MB (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB) · ไม่รองรับ`,
    );
  }

  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ไม่ทราบสาเหตุ";
    throw new Error(`อ่านไฟล์ XLSX ไม่สำเร็จ (ไฟล์อาจเสียหรือไม่ใช่ XLSX) · ${msg}`);
  }

  // Pick the preferred sheet name first, else the first sheet
  const sheetName =
    wb.SheetNames.find((n) => n === PREFERRED_SHEET_NAME) ?? wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("ไฟล์ XLSX ไม่มี sheet ใด ๆ");
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`ไม่พบ sheet "${sheetName}" ในไฟล์`);
  }

  // header:1 → array-of-arrays · raw:true → bypass formatted strings (date stays Date)
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  if (grid.length === 0) {
    return {
      totalRows: 0,
      parsedRows: [],
      errors: [],
      columnSet: [],
      missingColumns: Object.keys(COLUMN_ALIASES),
      unknownColumns: [],
      sheetName,
      branchNames: new Set(),
      dateRange: null,
      fileHash,
    };
  }

  const headerRow = (grid[0] as unknown[]).map((c) => toStr(c));
  const { index, unknownColumns } = buildHeaderIndex(headerRow);

  const missingColumns: string[] = [];
  for (const k of Object.keys(COLUMN_ALIASES) as (keyof StarThingRow)[]) {
    if (index[k] === undefined) missingColumns.push(k);
  }

  const errors: Array<{ row: number; message: string }> = [];
  const parsedRows: StarThingRow[] = [];
  const branchNames = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r) || r.every((c) => c == null || c === "")) continue; // skip empty
    const rowNum = i + 1; // 1-based for human-readable error msgs

    const get = (k: keyof StarThingRow): unknown => {
      const idx = index[k];
      return idx === undefined ? undefined : r[idx];
    };

    // Required field parsing — collect errors but keep parsing other rows
    const bizDate = parseDateLike(get("bizDate"));
    const chairCode = toStr(get("chairCode"));
    const storeName = toStr(get("storeName"));
    const cashRaw = parseNumber(get("cashTotal"));

    const rowErrors: string[] = [];
    if (!bizDate) rowErrors.push("วันที่อ่านไม่ออก");
    if (!chairCode) rowErrors.push("รหัสอุปกรณ์ว่าง");
    if (!storeName) rowErrors.push("ชื่อร้านว่าง");
    if (Number.isNaN(cashRaw)) rowErrors.push("จ่ายเงินสดไม่ใช่ตัวเลข");

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, message: rowErrors.join(" · ") });
      continue;
    }

    const grossTotal = parseNumber(get("grossTotal"));
    const onlineTotal = parseNumber(get("onlineTotal"));
    const otherTotal = parseNumber(get("otherTotal"));
    if ([grossTotal, onlineTotal, otherTotal].some((n) => Number.isNaN(n))) {
      errors.push({ row: rowNum, message: "ตัวเลข KPI อ่านไม่ออก" });
      continue;
    }

    const safe = (n: number) => (Number.isNaN(n) ? 0 : n);

    parsedRows.push({
      bizDate: bizDate!,
      chairCode,
      deviceType: toStr(get("deviceType")),
      machineNo: toOptStr(get("machineNo")),
      deviceGroup: toStr(get("deviceGroup")),
      storeName,
      grossTotal: safe(grossTotal),
      onlineTotal: safe(onlineTotal),
      cashTotal: safe(cashRaw),
      changeAmount: safe(parseNumber(get("changeAmount"))),
      paymentCount: Math.round(safe(parseNumber(get("paymentCount")))),
      otherTotal: safe(otherTotal),
      coinInsertCount: Math.round(safe(parseNumber(get("coinInsertCount")))),
      onlineCoin: Math.round(safe(parseNumber(get("onlineCoin")))),
      roundCount: parseOptionalNumber(get("roundCount")),
      itemCount: Math.round(safe(parseNumber(get("itemCount")))),
      giftName: toOptStr(get("giftName")),
      giftValue: safe(parseNumber(get("giftValue"))),
      giftRate: parseOptionalNumber(get("giftRate")),
      giftCoinUnit: parseOptionalNumber(get("giftCoinUnit")),
    });

    branchNames.add(storeName);
    if (minDate === null || bizDate! < minDate) minDate = bizDate;
    if (maxDate === null || bizDate! > maxDate) maxDate = bizDate;
  }

  return {
    totalRows: grid.length - 1,
    parsedRows,
    errors,
    columnSet: headerRow.filter((h) => h !== ""),
    missingColumns,
    unknownColumns,
    sheetName,
    branchNames,
    dateRange: minDate && maxDate ? { from: minDate, to: maxDate } : null,
    fileHash,
  };
}

// ---------------------------------------------------------------------------
// aggregateToBranchDaily — per-(store × date) sum across chairs
// ---------------------------------------------------------------------------

export function aggregateToBranchDaily(rows: StarThingRow[]): AggregatedDailyRow[] {
  const buckets = new Map<string, AggregatedDailyRow>();
  for (const r of rows) {
    const key = `${r.storeName}|${r.bizDate}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.cashTotal = round2(existing.cashTotal + r.cashTotal);
      existing.onlineTotal = round2(existing.onlineTotal + r.onlineTotal);
      existing.otherTotal = round2(existing.otherTotal + r.otherTotal);
      existing.grossTotal = round2(existing.grossTotal + r.grossTotal);
      existing.paymentCount += r.paymentCount;
      existing.coinInsertCount += r.coinInsertCount;
      existing.roundCount += r.roundCount ?? 0;
    } else {
      buckets.set(key, {
        bizDate: r.bizDate,
        storeName: r.storeName,
        cashTotal: round2(r.cashTotal),
        onlineTotal: round2(r.onlineTotal),
        otherTotal: round2(r.otherTotal),
        grossTotal: round2(r.grossTotal),
        paymentCount: r.paymentCount,
        coinInsertCount: r.coinInsertCount,
        roundCount: r.roundCount ?? 0,
      });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.bizDate !== b.bizDate) return a.bizDate < b.bizDate ? -1 : 1;
    return a.storeName < b.storeName ? -1 : 1;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// computeDiffBuckets — read DB, classify rows as new/same/changed
// ---------------------------------------------------------------------------

export async function computeDiffBuckets(
  prisma: PrismaClient,
  orgId: string,
  aggregatedRows: AggregatedDailyRow[],
): Promise<DiffBucket> {
  // 1) Resolve storeName → branchId via exact-match `ChairopsBranch.name`
  // Per `[[pool-csv-import-must-diff-before-write]]`: never auto-create.
  const uniqueStoreNames = Array.from(new Set(aggregatedRows.map((r) => r.storeName)));
  const branches = await prisma.chairopsBranch.findMany({
    where: { orgId, name: { in: uniqueStoreNames } },
    select: { id: true, name: true },
  });
  const knownBranches = new Map<string, string>();
  for (const b of branches) knownBranches.set(b.name, b.id);

  const unknownBranches = uniqueStoreNames.filter((n) => !knownBranches.has(n));

  // 2) For known branches, fetch existing ChairopsBranchDailyRevenue rows for date range
  const resolvedRows = aggregatedRows.filter((r) => knownBranches.has(r.storeName));
  const branchIds = Array.from(
    new Set(resolvedRows.map((r) => knownBranches.get(r.storeName)!)),
  );
  const dateStrings = Array.from(new Set(resolvedRows.map((r) => r.bizDate)));
  const dates = dateStrings.map((s) => new Date(`${s}T00:00:00.000Z`));

  type ExistingRow = {
    branchId: string;
    bizDate: Date;
    cashTotal: number;
    onlineTotal: number;
    otherTotal: number;
    grossTotal: number;
    paymentCount: number;
    coinInsertCount: number;
    roundCount: number;
  };

  let existing: ExistingRow[] = [];
  if (branchIds.length > 0 && dates.length > 0) {
    const found = await prisma.chairopsBranchDailyRevenue.findMany({
      where: {
        orgId,
        branchId: { in: branchIds },
        bizDate: { in: dates },
      },
      select: {
        branchId: true,
        bizDate: true,
        cashTotal: true,
        onlineTotal: true,
        otherTotal: true,
        grossTotal: true,
        paymentCount: true,
        coinInsertCount: true,
        roundCount: true,
      },
    });
    existing = found.map((f) => ({
      branchId: f.branchId,
      bizDate: f.bizDate,
      cashTotal: Number(f.cashTotal),
      onlineTotal: Number(f.onlineTotal),
      otherTotal: Number(f.otherTotal),
      grossTotal: Number(f.grossTotal),
      paymentCount: f.paymentCount,
      coinInsertCount: f.coinInsertCount,
      roundCount: f.roundCount,
    }));
  }

  // Index existing by (branchId, bizDate)
  const existingByKey = new Map<string, ExistingRow>();
  for (const e of existing) {
    const dateStr = e.bizDate.toISOString().slice(0, 10);
    existingByKey.set(`${e.branchId}|${dateStr}`, e);
  }

  // 3) Classify
  const newRows: AggregatedDailyRow[] = [];
  const sameRows: AggregatedDailyRow[] = [];
  const changedRows: DiffBucket["changedRows"] = [];

  for (const incoming of resolvedRows) {
    const branchId = knownBranches.get(incoming.storeName)!;
    const key = `${branchId}|${incoming.bizDate}`;
    const ex = existingByKey.get(key);
    if (!ex) {
      newRows.push(incoming);
      continue;
    }
    const sameNumbers =
      eq(ex.cashTotal, incoming.cashTotal) &&
      eq(ex.onlineTotal, incoming.onlineTotal) &&
      eq(ex.otherTotal, incoming.otherTotal) &&
      eq(ex.grossTotal, incoming.grossTotal) &&
      ex.paymentCount === incoming.paymentCount &&
      ex.coinInsertCount === incoming.coinInsertCount &&
      ex.roundCount === incoming.roundCount;
    if (sameNumbers) {
      sameRows.push(incoming);
    } else {
      changedRows.push({
        existing: {
          bizDate: incoming.bizDate,
          storeName: incoming.storeName,
          cashTotal: ex.cashTotal,
          onlineTotal: ex.onlineTotal,
          otherTotal: ex.otherTotal,
          grossTotal: ex.grossTotal,
          paymentCount: ex.paymentCount,
          coinInsertCount: ex.coinInsertCount,
          roundCount: ex.roundCount,
        },
        incoming,
      });
    }
  }

  return { newRows, sameRows, changedRows, unknownBranches, knownBranches };
}

function eq(a: number, b: number): boolean {
  // Decimal-stored values may carry trailing 0s; treat ≤0.005 baht diff as same
  return Math.abs(a - b) < 0.005;
}
