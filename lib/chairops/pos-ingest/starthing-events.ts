// StarThing POS EVENT-LOG parser (Plan B — timestamped per-second events)
//
// The daily-summary parser (`starthing-xlsx.ts`) handles 1-row-per-(chair×day).
// This module handles the TWO event-log exports from the StarThing portal:
//   - Cash event log: per cash insert · columns ...+ `การเพิ่มเงินสด` + `เงินสดทั้งหมด`
//   - Coin event log: per coin insert · columns ...+ `การเพิ่มเหรียญ` + `จำนวนเหรียญทั้งหมด`
//
// Both share 6 leading columns:
//   เวลา (timestamp YYYY-MM-DD HH:MM:SS, per-second) · รหัสอุปกรณ์ (device id) ·
//   ประเภทอุปกรณ์ · หมายเลขเครื่องจักร (e.g. NO.5, often blank) ·
//   การจัดกลุ่มอุปกรณ์ · ชื่อร้าน (e.g. "robinsonกาญ (900)")
//
// These per-second events unlock per-maid-collection NOON-WINDOW reconcile
// (daily summary has no timestamps so can't do that).
//
// CEO #1 requirement: ROW-LEVEL DEDUP. rowHash = sha256(device|eventAtISO|amount|meter).
// The unique index (orgId, rowHash) makes re-uploading overlapping ranges a no-op.
//
// Reuses helpers from `starthing-xlsx.ts`: parseNumber · toStr · toOptStr · MAX_FILE_BYTES.

import * as XLSX from "xlsx";
import { createHash } from "crypto";
import {
  parseNumber,
  toStr,
  toOptStr,
  MAX_FILE_BYTES,
} from "./starthing-xlsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventKind = "cash" | "coin";
export type FileType = "daily" | "cash" | "coin" | "unknown";

/** One parsed event row (cash or coin). Amount/meter are kind-specific. */
export interface ParsedEventRow {
  /** UTC instant of the event (eventAt column parsed as Asia/Bangkok). */
  eventAt: Date;
  /** ISO string of eventAt (used inside rowHash + diff payloads). */
  eventAtISO: string;
  /** รหัสอุปกรณ์ — device id e.g. "G0310373" */
  chairDeviceId: string;
  /** หมายเลขเครื่องจักร — machine label e.g. "NO.5" · often blank */
  chairNumber: string | null;
  /** ชื่อร้าน — raw store name, matched to ChairopsBranch.name */
  storeName: string;
  /** cash: การเพิ่มเงินสด (Decimal baht) · coin: การเพิ่มเหรียญ (integer count) */
  amount: number;
  /** cash: เงินสดทั้งหมด (cumulative Decimal) · coin: จำนวนเหรียญทั้งหมด (cumulative int) */
  meter: number;
  /** sha256(device|eventAtISO|amount|meter) — row-level dedup key */
  rowHash: string;
}

export interface EventParseResult {
  kind: EventKind;
  totalRows: number;
  parsedRows: ParsedEventRow[];
  errors: Array<{ row: number; message: string }>;
  /** Headers found in the sheet (for surfacing schema drift to CEO). */
  columnSet: string[];
  /** Unique storeName values found. */
  branchNames: Set<string>;
  dateRange: { from: string; to: string } | null;
  /** SHA256 of the whole file buffer · for ChairopsPosImport.fileHash. */
  fileHash: string;
  sheetName: string;
}

// ---------------------------------------------------------------------------
// Column aliases
// ---------------------------------------------------------------------------

const SHARED_ALIASES = {
  eventAt: ["เวลา", "time", "datetime"],
  chairDeviceId: ["รหัสอุปกรณ์", "เลขเครื่อง", "เครื่อง"],
  chairNumber: ["หมายเลขเครื่องจักร"],
  storeName: ["ชื่อร้าน", "สาขา"],
} as const;

const CASH_AMOUNT_ALIASES = ["การเพิ่มเงินสด"] as const;
const CASH_METER_ALIASES = ["เงินสดทั้งหมด"] as const;
const COIN_AMOUNT_ALIASES = ["การเพิ่มเหรียญ"] as const;
const COIN_METER_ALIASES = ["จำนวนเหรียญทั้งหมด"] as const;

// Daily-summary discriminators (so detectFileType can tell them apart).
const DAILY_DISCRIMINATORS = ["เต็มจำนวน", "จ่ายเงินสด"] as const;

// ---------------------------------------------------------------------------
// detectFileType — header sniff
// ---------------------------------------------------------------------------

/**
 * Classify a sheet by its headers:
 *   - "cash"  → has `การเพิ่มเงินสด`
 *   - "coin"  → has `การเพิ่มเหรียญ`
 *   - "daily" → has `เต็มจำนวน` / `จ่ายเงินสด` (the existing summary export)
 *   - "unknown"
 * Cash/coin checked first since a malformed daily file shouldn't shadow them.
 */
export function detectFileType(headers: string[]): FileType {
  const set = new Set(headers.map((h) => (h ?? "").trim()).filter(Boolean));
  if (CASH_AMOUNT_ALIASES.some((h) => set.has(h))) return "cash";
  if (COIN_AMOUNT_ALIASES.some((h) => set.has(h))) return "coin";
  if (DAILY_DISCRIMINATORS.some((h) => set.has(h))) return "daily";
  return "unknown";
}

/** Read the first (or preferred) sheet's header row from a buffer · for detectFileType. */
export function readHeaders(fileBuffer: Buffer): {
  headers: string[];
  sheetName: string;
} {
  const wb = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0] ?? "";
  if (!sheetName) return { headers: [], sheetName: "" };
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const headerRow = Array.isArray(grid[0]) ? (grid[0] as unknown[]).map(toStr) : [];
  return { headers: headerRow, sheetName };
}

// ---------------------------------------------------------------------------
// Timestamp parsing — eventAt is per-second, anchored to Asia/Bangkok (+07:00)
// ---------------------------------------------------------------------------

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // +07:00 · no DST in Thailand

/**
 * Parse "YYYY-MM-DD HH:MM:SS" (StarThing event timestamp, local Bangkok time)
 * into a UTC Date instant. Supports:
 *   - JS Date (from cellDates:true · Excel datetime cell) → treated as Bangkok wall-clock
 *   - "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS"
 *   - "YYYY-MM-DD HH:MM" (seconds optional → :00)
 *   - BE year auto-detected (> 2400 → −543)
 * Returns null if unparseable.
 *
 * We anchor to +07:00 explicitly so the stored timestamptz is the correct UTC
 * instant regardless of the server timezone (Vercel = UTC · dev = +07:00).
 */
export function parseEventTimestamp(v: unknown): Date | null {
  if (v == null || v === "") return null;

  // Excel datetime cell → Date with the wall-clock in UTC fields. Re-anchor to Bangkok.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const utcMs = Date.UTC(
      v.getUTCFullYear(),
      v.getUTCMonth(),
      v.getUTCDate(),
      v.getUTCHours(),
      v.getUTCMinutes(),
      v.getUTCSeconds(),
    );
    return new Date(utcMs - BANGKOK_OFFSET_MS);
  }

  const s = String(v).trim();
  if (!s) return null;

  const m = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
  );
  if (!m) return null;

  let year = Number(m[1]);
  if (year > 2400) year -= 543; // BE → AD
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;

  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return null;
  }

  // Build the UTC instant for the given Bangkok wall-clock time.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(utcMs - BANGKOK_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Header index
// ---------------------------------------------------------------------------

type EventField = "eventAt" | "chairDeviceId" | "chairNumber" | "storeName" | "amount" | "meter";

function buildEventHeaderIndex(
  rawHeader: string[],
  kind: EventKind,
): Partial<Record<EventField, number>> {
  const index: Partial<Record<EventField, number>> = {};
  const amountAliases = kind === "cash" ? CASH_AMOUNT_ALIASES : COIN_AMOUNT_ALIASES;
  const meterAliases = kind === "cash" ? CASH_METER_ALIASES : COIN_METER_ALIASES;
  const aliasMap: Record<EventField, readonly string[]> = {
    eventAt: SHARED_ALIASES.eventAt,
    chairDeviceId: SHARED_ALIASES.chairDeviceId,
    chairNumber: SHARED_ALIASES.chairNumber,
    storeName: SHARED_ALIASES.storeName,
    amount: amountAliases,
    meter: meterAliases,
  };
  for (const [keyRaw, aliases] of Object.entries(aliasMap)) {
    const key = keyRaw as EventField;
    for (let i = 0; i < rawHeader.length; i++) {
      const h = (rawHeader[i] ?? "").trim();
      if (h && aliases.includes(h) && index[key] === undefined) {
        index[key] = i;
      }
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Row hashing
// ---------------------------------------------------------------------------

/**
 * Row-level dedup key (CEO #1 requirement).
 * Format: sha256(`${device}|${eventAtISO}|${amount}|${meter}`)
 * amount/meter are normalized: cash → 2dp string · coin → integer string.
 */
export function computeEventRowHash(
  kind: EventKind,
  device: string,
  eventAtISO: string,
  amount: number,
  meter: number,
): string {
  const amt = kind === "cash" ? amount.toFixed(2) : String(Math.round(amount));
  const mtr = kind === "cash" ? meter.toFixed(2) : String(Math.round(meter));
  return createHash("sha256")
    .update(`${device}|${eventAtISO}|${amt}|${mtr}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

function parseEvents(fileBuffer: Buffer, kind: EventKind): EventParseResult {
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

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("ไฟล์ XLSX ไม่มี sheet ใด ๆ");
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`ไม่พบ sheet "${sheetName}" ในไฟล์`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  const emptyResult: EventParseResult = {
    kind,
    totalRows: 0,
    parsedRows: [],
    errors: [],
    columnSet: [],
    branchNames: new Set(),
    dateRange: null,
    fileHash,
    sheetName,
  };
  if (grid.length === 0) return emptyResult;

  const headerRow = (grid[0] as unknown[]).map(toStr);
  const index = buildEventHeaderIndex(headerRow, kind);

  const errors: Array<{ row: number; message: string }> = [];
  const parsedRows: ParsedEventRow[] = [];
  const branchNames = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r) || r.every((c) => c == null || c === "")) continue;
    const rowNum = i + 1; // 1-based for human-readable error msgs

    const get = (k: EventField): unknown => {
      const idx = index[k];
      return idx === undefined ? undefined : r[idx];
    };

    const eventAt = parseEventTimestamp(get("eventAt"));
    const chairDeviceId = toStr(get("chairDeviceId"));
    const storeName = toStr(get("storeName"));
    const amountRaw = parseNumber(get("amount"));
    const meterRaw = parseNumber(get("meter"));

    const rowErrors: string[] = [];
    if (!eventAt) rowErrors.push("เวลาอ่านไม่ออก");
    if (!chairDeviceId) rowErrors.push("รหัสอุปกรณ์ว่าง");
    if (!storeName) rowErrors.push("ชื่อร้านว่าง");
    if (Number.isNaN(amountRaw)) rowErrors.push("จำนวนเงิน/เหรียญที่เพิ่มไม่ใช่ตัวเลข");
    if (Number.isNaN(meterRaw)) rowErrors.push("ยอดสะสมไม่ใช่ตัวเลข");

    if (rowErrors.length > 0 || !eventAt) {
      errors.push({ row: rowNum, message: rowErrors.join(" · ") });
      continue;
    }

    // coin amounts/meters are counts → round to integer
    const amount = kind === "coin" ? Math.round(amountRaw) : amountRaw;
    const meter = kind === "coin" ? Math.round(meterRaw) : meterRaw;
    const eventAtISO = eventAt.toISOString();
    const rowHash = computeEventRowHash(kind, chairDeviceId, eventAtISO, amount, meter);

    parsedRows.push({
      eventAt,
      eventAtISO,
      chairDeviceId,
      chairNumber: toOptStr(get("chairNumber")),
      storeName,
      amount,
      meter,
      rowHash,
    });

    branchNames.add(storeName);
    const dateStr = eventAtISO.slice(0, 10);
    if (minDate === null || dateStr < minDate) minDate = dateStr;
    if (maxDate === null || dateStr > maxDate) maxDate = dateStr;
  }

  return {
    kind,
    totalRows: grid.length - 1,
    parsedRows,
    errors,
    columnSet: headerRow.filter((h) => h !== ""),
    branchNames,
    dateRange: minDate && maxDate ? { from: minDate, to: maxDate } : null,
    fileHash,
    sheetName,
  };
}

/** Parse a StarThing CASH event-log XLSX. */
export function parseCashEvents(fileBuffer: Buffer): EventParseResult {
  return parseEvents(fileBuffer, "cash");
}

/** Parse a StarThing COIN event-log XLSX. */
export function parseCoinEvents(fileBuffer: Buffer): EventParseResult {
  return parseEvents(fileBuffer, "coin");
}
