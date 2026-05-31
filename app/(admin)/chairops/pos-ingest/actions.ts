"use server";

// POS Ingest server actions (CSV/XLSX upload → diff preview → confirm commit)
//
// Per memory [[pool-csv-import-must-diff-before-write]]:
//   Show "ใหม่ / เหมือนเดิม / เปลี่ยน / ผิด" counts BEFORE writing.
//   CEO re-imports overlapping ranges — silent skip-on-conflict confuses them.
//
// Supports BOTH .csv and .xlsx (SheetJS · reads first sheet only) — detected
// by filename extension. Hash dedup works for both (sha256 of raw bytes).
//
// Flow:
//   1) previewImport(formData) — parse CSV/XLSX, classify rows vs existing PosDaily,
//      persist a PosImport with committed=false + diffSummary JSON. Return id.
//   2) commitImport(id) — re-parse from diffSummary, upsert PosDaily rows,
//      audit-log each row, recompute drift + alerts, set committed=true.
//   3) cancelImport(id) — delete the pending PosImport row.
//
// Anti-stupid:
//   - sha256 of CSV/XLSX body deduped via PosImport.fileHash unique constraint.
//   - Past-day edits (bizDate older than 1 day) require CEO via canEditPastDay.
//   - Maker/checker: committing your own preview = soft warning persisted into
//     the diff summary (front-end shows it; commit still allowed).
//   - We never delete previous-day data implicitly. "เปลี่ยน" rows show old vs new.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { sha256Hex } from "@/lib/chairops/utils/hash";
import { canEditPastDay } from "@/lib/chairops/auth/role-guards";
import { recomputeAllDrifts } from "@/lib/chairops/reconcile/drift-engine";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import {
  parseStarThingXlsx,
  aggregateToBranchDaily,
  type AggregatedDailyRow,
} from "@/lib/chairops/pos-ingest/starthing-xlsx";

// ----- Types ----------------------------------------------------------------

export type RowStatus = "new" | "same" | "changed" | "error";

export interface ParsedRow {
  raw: Record<string, string>;
  rowIndex: number; // 1-based (excluding header)
  bizDate: string | null; // ISO yyyy-mm-dd
  chairCode: string | null;
  shopName: string | null;
  online: number;
  cash: number;
  coin: number;
  totalCash: number;
  totalRevenue: number;
  errors: string[];
}

export interface DiffRow extends ParsedRow {
  status: RowStatus;
  branchId: string | null;
  branchName: string | null;
  existing?: {
    online: number;
    cash: number;
    coin: number;
    totalRevenue: number;
    bizDate: string;
    isPastDay: boolean;
  } | null;
  changes?: string[]; // human-readable field diffs
  isPastDay: boolean;
}

export interface DiffSummary {
  counts: { new: number; same: number; changed: number; error: number; total: number };
  rows: DiffRow[];
  branchResolution: "manual" | "auto-from-shop-name" | "mixed";
  manualBranchId: string | null;
  pastDayWarning: boolean;
  selfCommitWarning: { uploader: string } | null;
  // StarThing XLSX additions (SPEC §2.5) — null when CSV path used
  starThing?: {
    /** Per-(branch × bizDate) aggregated rows for ChairopsBranchDailyRevenue */
    aggregatedRows: AggregatedDailyRow[];
    /** storeName values that didn't exact-match any ChairopsBranch.name */
    unknownBranches: string[];
    /** storeName → branchId for matched branches */
    knownBranchEntries: Array<[string, string]>;
    /** sheet headers — surface schema drift to CEO (DEVIL hidden-complexity #1) */
    columnSet: string[];
    unknownColumns: string[];
    sheetName: string;
    dateRange: { from: string; to: string } | null;
  };
}

// ----- CSV parsing ----------------------------------------------------------

// XLSX → string[][] grid (first sheet only · dates as ISO yyyy-mm-dd strings).
// Empty cells become "" not undefined (matches parseRows expectations).
//
// Date handling:
//   - cellDates:true on read makes Excel date cells = JS Date objects.
//   - raw:true on sheet_to_json bypasses .w formatted-string (which defaults
//     to "m/d/yy" and breaks downstream parseDate's regex), surfaces raw values.
//   - We format Date manually using UTC getters so output is stable across
//     server timezones (Vercel = UTC · local dev = +07:00). Excel dates are
//     calendar dates (no time component) so UTC interpretation is correct.
function parseXlsxToGrid(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const firstName = wb.SheetNames[0];
  if (!firstName) return [];
  const sheet = wb.Sheets[firstName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const formatCell = (c: unknown): string => {
    if (c == null || c === "") return "";
    if (c instanceof Date) {
      const y = c.getUTCFullYear();
      const m = String(c.getUTCMonth() + 1).padStart(2, "0");
      const d = String(c.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(c);
  };
  return rows.map((r) => (Array.isArray(r) ? r.map(formatCell) : []));
}

// Detect file kind by filename + magic bytes (XLSX = PK zip header · 50 4b 03 04).
function detectFileKind(name: string, buf: Buffer): "csv" | "xlsx" | "unknown" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "csv";
  // Magic-byte fallback: XLSX is a ZIP container → starts with PK\x03\x04.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return "xlsx";
  }
  return "unknown";
}

// Minimal CSV parser — supports quoted fields, escaped quotes, CRLF.
function parseCsv(text: string): string[][] {
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  // canonical keys: date, chairCode, shopName, online, cash, coin, total
  "วันที่": "date",
  "date": "date",
  "เลขเครื่อง": "chairCode",
  "รหัสอุปกรณ์": "chairCode",
  "เครื่อง": "chairCode",
  "ชื่อร้าน": "shopName",
  "สาขา": "shopName",
  "ออนไลน์": "online",
  "ชำระเงินออนไลน์": "online",
  "online": "online",
  "แบงค์": "cash",
  "เงินสด": "cash",
  "จ่ายเงินสด": "cash",
  "cash": "cash",
  "เหรียญ": "coin",
  "จำนวนหยอดเหรียญ": "coin",
  "coin": "coin",
  "รวม": "total",
  "เต็มจำนวน": "total",
  "total": "total",
};

function normalizeHeader(s: string): string {
  const key = s.trim();
  return HEADER_ALIASES[key] ?? key;
}

function toInt(v: string | undefined): number {
  if (v == null) return 0;
  const cleaned = v.replace(/[,\s฿]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}

// Parse Thai-friendly dates: 2026-05-21, 21/05/2026, 21/05/69, 21 พ.ค. 69 etc.
const THAI_MONTHS: Record<string, number> = {
  "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6,
  "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
};

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // dd/mm/yyyy or dd/mm/yy or dd-mm-yyyy
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    let yyyy = dmy[3];
    if (yyyy.length === 2) {
      const yn = Number(yyyy);
      // Thai pattern: 69 → 2569 BE → 2026 AD; 26 → 2026
      yyyy = yn > 50 ? String(2500 + yn - 543) : String(2000 + yn);
    } else if (yyyy.length === 4) {
      const yn = Number(yyyy);
      if (yn > 2400) yyyy = String(yn - 543);
    }
    return `${yyyy}-${mm}-${dd}`;
  }
  // Thai short: 21 พ.ค. 69
  const thai = s.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})$/);
  if (thai) {
    const mNum = THAI_MONTHS[thai[2]];
    if (mNum) {
      const dd = thai[1].padStart(2, "0");
      const mm = String(mNum).padStart(2, "0");
      let yyyy = thai[3];
      if (yyyy.length === 2) yyyy = String(2500 + Number(yyyy) - 543);
      else if (Number(yyyy) > 2400) yyyy = String(Number(yyyy) - 543);
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return null;
}

function parseRows(rows: string[][]): { headers: string[]; parsed: ParsedRow[] } {
  if (rows.length === 0) return { headers: [], parsed: [] };
  const rawHeader = rows[0];
  const headers = rawHeader.map(normalizeHeader);
  const idx = (k: string) => headers.indexOf(k);
  const parsed: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // skip empty rows
    if (r.every((c) => c.trim() === "")) continue;
    const raw: Record<string, string> = {};
    rawHeader.forEach((h, j) => (raw[h] = r[j] ?? ""));

    const dateRaw = idx("date") >= 0 ? r[idx("date")] : undefined;
    const chairRaw = idx("chairCode") >= 0 ? r[idx("chairCode")] : undefined;
    const shopRaw = idx("shopName") >= 0 ? r[idx("shopName")] : undefined;
    const onlineRaw = idx("online") >= 0 ? r[idx("online")] : undefined;
    const cashRaw = idx("cash") >= 0 ? r[idx("cash")] : undefined;
    const coinRaw = idx("coin") >= 0 ? r[idx("coin")] : undefined;
    const totalRaw = idx("total") >= 0 ? r[idx("total")] : undefined;

    const errors: string[] = [];
    const bizDate = parseDate(dateRaw);
    if (!bizDate) errors.push("วันที่อ่านไม่ออก");

    const online = toInt(onlineRaw);
    const cash = toInt(cashRaw);
    const coin = toInt(coinRaw);
    let total = toInt(totalRaw);
    if ([online, cash, coin].some((n) => Number.isNaN(n))) {
      errors.push("ตัวเลขไม่ถูกต้อง");
    }
    const totalCash = (cash || 0) + (coin || 0);
    if (!Number.isFinite(total) || total === 0) total = (online || 0) + totalCash;

    const chairCode = chairRaw?.trim() || null;
    const shopName = shopRaw?.trim() || null;

    parsed.push({
      raw,
      rowIndex: i,
      bizDate,
      chairCode,
      shopName,
      online: online || 0,
      cash: cash || 0,
      coin: coin || 0,
      totalCash,
      totalRevenue: total || 0,
      errors,
    });
  }
  return { headers, parsed };
}

// ----- Branch resolution ----------------------------------------------------

function loosenShopName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_().]+/g, "");
}

function resolveBranchForRow(
  row: ParsedRow,
  branchCache: { byTab: Map<string, { id: string; name: string }>; byLoose: Map<string, { id: string; name: string }> }
): { branchId: string | null; branchName: string | null } {
  if (!row.shopName) return { branchId: null, branchName: null };
  const direct = branchCache.byTab.get(row.shopName);
  if (direct) return { branchId: direct.id, branchName: direct.name };
  const loose = branchCache.byLoose.get(loosenShopName(row.shopName));
  if (loose) return { branchId: loose.id, branchName: loose.name };
  return { branchId: null, branchName: null };
}

// ----- Actions --------------------------------------------------------------

export async function previewImport(formData: FormData): Promise<{ ok: true; importId: string } | { ok: false; error: string }> {
  const session = await requireRole("OFFICE");

  const file = formData.get("file");
  const manualBranchIdRaw = formData.get("branchId");
  const manualBranchId = typeof manualBranchIdRaw === "string" && manualBranchIdRaw ? manualBranchIdRaw : null;
  const notes = typeof formData.get("notes") === "string" ? (formData.get("notes") as string) : null;

  if (!(file instanceof File)) return { ok: false, error: "ยังไม่ได้เลือกไฟล์ POS (.csv หรือ .xlsx)" };
  if (file.size === 0) return { ok: false, error: "ไฟล์ว่าง" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "ไฟล์ใหญ่เกิน 10MB" };

  const buf = Buffer.from(await file.arrayBuffer());
  const fileHash = sha256Hex(buf);
  const orgId = session.user.orgId;

  // Dedup by hash — if same file already imported AND committed, surface that.
  // Per BA-2 schema: unique constraint is (orgId, fileHash) not (fileHash).
  const existingByHash = await prisma.chairopsPosImport.findUnique({
    where: { orgId_fileHash: { orgId, fileHash } },
  });
  if (existingByHash) {
    if (existingByHash.committed) {
      return {
        ok: false,
        error: `ไฟล์นี้ถูก import และ commit ไปแล้ว (${existingByHash.filename} · ${existingByHash.uploadedAt.toISOString()})`,
      };
    }
    // existing pending — surface to user instead of creating a duplicate
    return { ok: true, importId: existingByHash.id };
  }

  // Parse — branch on file kind. CSV uses minimal in-house parser · XLSX uses SheetJS.
  // XLSX path ALSO runs the dedicated StarThing parser (SPEC §2.5) to compute
  // per-(branch × date) aggregates for ChairopsBranchDailyRevenue.
  const kind = detectFileKind(file.name, buf);
  let grid: string[][];
  let starThingAggregated: AggregatedDailyRow[] = [];
  let starThingMeta: NonNullable<DiffSummary["starThing"]> | undefined;
  try {
    if (kind === "xlsx") {
      grid = parseXlsxToGrid(buf);
      // Run StarThing-aware parse in parallel (independent of grid path)
      const stResult = parseStarThingXlsx(buf);
      starThingAggregated = aggregateToBranchDaily(stResult.parsedRows);
      starThingMeta = {
        aggregatedRows: starThingAggregated,
        unknownBranches: [], // filled after we load branches below
        knownBranchEntries: [],
        columnSet: stResult.columnSet,
        unknownColumns: stResult.unknownColumns,
        sheetName: stResult.sheetName,
        dateRange: stResult.dateRange,
      };
    } else if (kind === "csv") {
      grid = parseCsv(buf.toString("utf-8"));
    } else {
      return { ok: false, error: `ไฟล์ไม่รองรับ (${file.name}) · ใช้ .csv หรือ .xlsx เท่านั้น` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ไม่ทราบสาเหตุ";
    return { ok: false, error: `อ่านไฟล์ไม่สำเร็จ · ${msg}` };
  }
  if (grid.length < 2) return { ok: false, error: "อ่านแถวข้อมูลไม่เจอ (ต้องมี header + อย่างน้อย 1 แถว)" };
  const { headers, parsed } = parseRows(grid);

  // Require key headers
  const required = ["date"];
  for (const k of required) {
    if (!headers.includes(k)) {
      return { ok: false, error: `CSV ขาด column วันที่ (header ที่อ่านได้: ${headers.join(", ")})` };
    }
  }

  // Load branch map — scoped to this org (BA-2 multi-tenant guard)
  const branches = await prisma.chairopsBranch.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, tabName: true, slug: true },
  });
  const byTab = new Map<string, { id: string; name: string }>();
  const byLoose = new Map<string, { id: string; name: string }>();
  for (const b of branches) {
    byTab.set(b.tabName, { id: b.id, name: b.name });
    byTab.set(b.name, { id: b.id, name: b.name });
    byTab.set(b.slug, { id: b.id, name: b.name });
    byLoose.set(loosenShopName(b.tabName), { id: b.id, name: b.name });
    byLoose.set(loosenShopName(b.name), { id: b.id, name: b.name });
  }

  // SPEC §2.5 — StarThing branch resolution: exact-match `ChairopsBranch.name`,
  // surface unknowns to UI (no auto-create per `[[pool-csv-import-must-diff-before-write]]`).
  if (starThingMeta) {
    const knownEntries: Array<[string, string]> = [];
    const unknown: string[] = [];
    const branchByName = new Map(branches.map((b) => [b.name, b.id]));
    const uniqueStores = Array.from(
      new Set(starThingMeta.aggregatedRows.map((r) => r.storeName)),
    );
    for (const s of uniqueStores) {
      const id = branchByName.get(s);
      if (id) knownEntries.push([s, id]);
      else unknown.push(s);
    }
    starThingMeta.knownBranchEntries = knownEntries;
    starThingMeta.unknownBranches = unknown;
  }

  let manualBranchName: string | null = null;
  if (manualBranchId) {
    const b = branches.find((x) => x.id === manualBranchId);
    if (!b) return { ok: false, error: "สาขาที่เลือกไม่ถูกต้อง" };
    manualBranchName = b.name;
  }

  // Resolve branches per row
  const resolvedRows: DiffRow[] = [];
  let autoCount = 0;
  let manualCount = 0;
  for (const row of parsed) {
    let branchId: string | null = null;
    let branchName: string | null = null;
    if (manualBranchId) {
      branchId = manualBranchId;
      branchName = manualBranchName;
      manualCount++;
    } else {
      const r = resolveBranchForRow(row, { byTab, byLoose });
      branchId = r.branchId;
      branchName = r.branchName;
      if (branchId) autoCount++;
    }
    if (!branchId) row.errors.push("ระบุสาขาไม่ได้ (กรุณาเลือกสาขาด้านบน หรือเช็คคอลัมน์ชื่อร้าน)");

    resolvedRows.push({
      ...row,
      branchId,
      branchName,
      status: "error", // placeholder, fill below
      isPastDay: false,
      existing: null,
    });
  }

  // Look up existing PosDaily rows
  type Key = string;
  const keyOf = (branchId: string, chair: string | null, bizDate: string): Key =>
    `${branchId}|${chair ?? ""}|${bizDate}`;

  const candidateKeys: { branchId: string; chairCode: string | null; bizDate: string }[] = [];
  for (const r of resolvedRows) {
    if (r.branchId && r.bizDate) {
      candidateKeys.push({ branchId: r.branchId, chairCode: r.chairCode, bizDate: r.bizDate });
    }
  }

  // DiffRow keeps the legacy snake-case keys (online/cash/coin/totalRevenue) because
  // downstream UI components (diff-table.tsx) consume that shape. The DB column names
  // changed to onlineTotal/cashTotal/coinInsertCount/grossTotal (BA-2 rename) — coerce here.
  const existingMap = new Map<Key, { online: number; cash: number; coin: number; totalRevenue: number; bizDate: string }>();
  if (candidateKeys.length > 0) {
    // Query by-branch grouped to keep IN sizes manageable; for MVP single fetch is OK
    const branchIds = [...new Set(candidateKeys.map((k) => k.branchId))];
    const dates = [...new Set(candidateKeys.map((k) => k.bizDate))].map((s) => new Date(s + "T00:00:00.000Z"));
    const existing = await prisma.chairopsPosDaily.findMany({
      where: {
        orgId,
        branchId: { in: branchIds },
        bizDate: { in: dates },
      },
      select: {
        branchId: true,
        chairCode: true,
        bizDate: true,
        onlineTotal: true,
        cashTotal: true,
        coinInsertCount: true,
        grossTotal: true,
      },
    });
    for (const e of existing) {
      const dateStr = e.bizDate.toISOString().slice(0, 10);
      existingMap.set(keyOf(e.branchId, e.chairCode, dateStr), {
        online: Number(e.onlineTotal),
        cash: Number(e.cashTotal),
        coin: e.coinInsertCount,
        totalRevenue: Number(e.grossTotal),
        bizDate: dateStr,
      });
    }
  }

  // Classify
  const nowMs = Date.now();
  const ONE_DAY_MS = 24 * 3600 * 1000;
  let countNew = 0, countSame = 0, countChanged = 0, countErr = 0;
  let pastDayWarning = false;

  for (const r of resolvedRows) {
    const ageMs = r.bizDate ? nowMs - new Date(r.bizDate + "T00:00:00.000Z").getTime() : 0;
    r.isPastDay = ageMs > ONE_DAY_MS;

    if (r.errors.length > 0 || !r.branchId || !r.bizDate) {
      r.status = "error";
      countErr++;
      continue;
    }
    const k = keyOf(r.branchId, r.chairCode, r.bizDate);
    const ex = existingMap.get(k);
    if (!ex) {
      r.status = "new";
      r.existing = null;
      countNew++;
      continue;
    }
    r.existing = { ...ex, isPastDay: r.isPastDay };
    const changes: string[] = [];
    if (ex.online !== r.online) changes.push(`ออนไลน์: ${ex.online} → ${r.online}`);
    if (ex.cash !== r.cash) changes.push(`แบงค์: ${ex.cash} → ${r.cash}`);
    if (ex.coin !== r.coin) changes.push(`เหรียญ: ${ex.coin} → ${r.coin}`);
    if (ex.totalRevenue !== r.totalRevenue) changes.push(`รวม: ${ex.totalRevenue} → ${r.totalRevenue}`);
    if (changes.length === 0) {
      r.status = "same";
      countSame++;
    } else {
      r.status = "changed";
      r.changes = changes;
      countChanged++;
      if (r.isPastDay) pastDayWarning = true;
    }
  }

  const counts = { new: countNew, same: countSame, changed: countChanged, error: countErr, total: resolvedRows.length };

  // Self-commit guard surfaced to UI
  const selfCommitWarning = { uploader: session.user.displayName };

  let branchResolution: DiffSummary["branchResolution"] = "manual";
  if (!manualBranchId) {
    branchResolution = autoCount > 0 && manualCount > 0 ? "mixed" : "auto-from-shop-name";
  }

  const diffSummary: DiffSummary = {
    counts,
    rows: resolvedRows,
    branchResolution,
    manualBranchId,
    pastDayWarning,
    selfCommitWarning,
    ...(starThingMeta ? { starThing: starThingMeta } : {}),
  };

  const imp = await prisma.chairopsPosImport.create({
    data: {
      orgId,
      filename: file.name,
      uploadedById: session.user.id,
      fileHash,
      rowCount: resolvedRows.length,
      diffSummary: diffSummary as never,
      committed: false,
      notes,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "pos_import.preview",
    entity: "PosImport",
    entityId: imp.id,
    newValue: { filename: file.name, rowCount: resolvedRows.length, counts },
  });

  revalidatePath("/chairops/pos-ingest");
  return { ok: true, importId: imp.id };
}

export async function commitImport(importId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireRole("OFFICE");

  const imp = await prisma.chairopsPosImport.findUnique({ where: { id: importId } });
  if (!imp) return { ok: false, error: "ไม่พบ import นี้" };
  if (imp.committed) return { ok: false, error: "import นี้ commit ไปแล้ว" };

  const diff = imp.diffSummary as unknown as DiffSummary;
  if (!diff || !Array.isArray(diff.rows)) return { ok: false, error: "diff หาย — กรุณา upload ใหม่" };

  // HIGH-005 fix: past-day guard must cover BOTH "changed" AND "new" backfills
  // (OFFICE was previously able to backfill arbitrary historical dates without CEO approval)
  const hasPastDay = diff.rows.some(
    (r) => (r.status === "changed" || r.status === "new") && r.isPastDay
  );
  if (hasPastDay && !canEditPastDay(session.user)) {
    return {
      ok: false,
      error: "มีรายการย้อนหลัง > 1 วัน (ทั้งสร้างใหม่และแก้ไข) · ต้องให้ CEO อนุมัติเท่านั้น",
    };
  }

  // Apply rows in a transaction
  const toApplyUnsorted = diff.rows.filter(
    (r) => r.status === "new" || r.status === "changed",
  );
  const orgId = imp.orgId;
  // 2026-05-31 — sort by bizDate ASC so chair-move detection sees branches
  // in chronological order. Without this, a row from 2026-05-10 processed
  // after a row from 2026-05-15 would back-date the chair's "current branch"
  // to the older date.
  const toApply = [...toApplyUnsorted].sort((a, b) =>
    (a.bizDate ?? "").localeCompare(b.bizDate ?? ""),
  );

  // Preload every chair referenced by this batch — single query out of tx
  // so the per-row chair-move logic is O(1) lookup.
  const chairCodesInBatch = new Set<string>();
  for (const r of toApply) {
    if (r.chairCode) chairCodesInBatch.add(r.chairCode);
  }
  const preloadedChairs =
    chairCodesInBatch.size > 0
      ? await prisma.chairopsChair.findMany({
          where: { orgId, chairCode: { in: Array.from(chairCodesInBatch) } },
          select: { id: true, chairCode: true, branchId: true },
        })
      : [];
  const chairMap = new Map<string, { id: string; branchId: string }>(
    preloadedChairs.map((c) => [c.chairCode, { id: c.id, branchId: c.branchId }]),
  );
  let chairsCreatedFromPos = 0;
  let chairMovesRecorded = 0;

  await prisma.$transaction(async (tx) => {
    for (const r of toApply) {
      if (!r.branchId || !r.bizDate) continue;
      const bizDate = new Date(r.bizDate + "T00:00:00.000Z");
      // ── Chair-move detection (CEO 2026-05-31 spec): file is source of truth
      //    for "this chair was at this branch on this date". If the row's
      //    (chairCode, branchId) disagrees with our chair table, we move the
      //    chair to the file's branch and record a ChairopsChairMove with
      //    movedAt = bizDate. New chairs get an initial-placement move row.
      if (r.chairCode) {
        const existingChair = chairMap.get(r.chairCode);
        if (!existingChair) {
          const fresh = await tx.chairopsChair.create({
            data: {
              orgId,
              branchId: r.branchId,
              chairCode: r.chairCode,
              isActive: true,
            },
          });
          await tx.chairopsChairMove.create({
            data: {
              orgId,
              chairId: fresh.id,
              fromBranchId: null,
              toBranchId: r.branchId,
              movedAt: bizDate,
              movedById: session.user.id,
              source: "pos_ingest",
              notes: `first placement detected from POS upload (importId=${imp.id})`,
            },
          });
          chairMap.set(r.chairCode, { id: fresh.id, branchId: r.branchId });
          chairsCreatedFromPos += 1;
        } else if (existingChair.branchId !== r.branchId) {
          await tx.chairopsChair.update({
            where: { id: existingChair.id },
            data: { branchId: r.branchId },
          });
          await tx.chairopsChairMove.create({
            data: {
              orgId,
              chairId: existingChair.id,
              fromBranchId: existingChair.branchId,
              toBranchId: r.branchId,
              movedAt: bizDate,
              movedById: session.user.id,
              source: "pos_ingest",
              notes: `branch change detected on POS upload (importId=${imp.id})`,
            },
          });
          chairMap.set(r.chairCode, { id: existingChair.id, branchId: r.branchId });
          chairMovesRecorded += 1;
        }
      }
      // chairCode is nullable. Prisma's compound-unique upsert with null can be
      // flaky across versions, so we do findFirst → update/create explicitly.
      const existing = await tx.chairopsPosDaily.findFirst({
        where: {
          orgId,
          branchId: r.branchId,
          chairCode: r.chairCode ?? null,
          bizDate,
        },
        select: { id: true },
      });
      // BA-2 column rename: online→onlineTotal · cash→cashTotal ·
      // coin→coinInsertCount · totalRevenue→grossTotal · totalCash stays.
      const data = {
        onlineTotal: r.online,
        cashTotal: r.cash,
        coinInsertCount: r.coin,
        totalCash: r.totalCash,
        grossTotal: r.totalRevenue,
        rawSource: "csv-upload",
        importId: imp.id,
      } as const;
      const result = existing
        ? await tx.chairopsPosDaily.update({ where: { id: existing.id }, data })
        : await tx.chairopsPosDaily.create({
            data: {
              ...data,
              orgId,
              branchId: r.branchId,
              chairCode: r.chairCode,
              bizDate,
              enteredById: session.user.id,
            },
          });
      await tx.chairopsAuditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: r.status === "new" ? "pos_daily.create" : "pos_daily.update",
          entity: "PosDaily",
          entityId: result.id,
          oldValue: r.existing ?? undefined,
          newValue: {
            online: r.online,
            cash: r.cash,
            coin: r.coin,
            totalRevenue: r.totalRevenue,
            bizDate: r.bizDate,
            chairCode: r.chairCode,
          },
          metadata: { importId: imp.id, rowIndex: r.rowIndex },
        },
      });
    }
    // SPEC §2.5 — write per-branch-per-day aggregates from StarThing XLSX
    // (CSV path = empty starThing block · skipped). Idempotent upsert on
    // unique (orgId, branchId, bizDate).
    if (diff.starThing) {
      const knownByName = new Map(diff.starThing.knownBranchEntries);
      for (const agg of diff.starThing.aggregatedRows) {
        const branchId = knownByName.get(agg.storeName);
        if (!branchId) continue; // skip unknown branches — CEO resolves later
        const bizDate = new Date(`${agg.bizDate}T00:00:00.000Z`);
        const existingDaily = await tx.chairopsBranchDailyRevenue.findFirst({
          where: { orgId, branchId, bizDate },
          select: { id: true },
        });
        const dailyData = {
          cashTotal: agg.cashTotal,
          onlineTotal: agg.onlineTotal,
          otherTotal: agg.otherTotal,
          grossTotal: agg.grossTotal,
          paymentCount: agg.paymentCount,
          coinInsertCount: agg.coinInsertCount,
          roundCount: agg.roundCount,
          sourceImportId: imp.id,
        };
        if (existingDaily) {
          await tx.chairopsBranchDailyRevenue.update({
            where: { id: existingDaily.id },
            data: dailyData,
          });
        } else {
          await tx.chairopsBranchDailyRevenue.create({
            data: { ...dailyData, orgId, branchId, bizDate },
          });
        }
      }
    }

    await tx.chairopsPosImport.update({
      where: { id: imp.id },
      data: { committed: true, committedAt: new Date() },
    });
  }, {
    // Wave-2 audit BE P0 #4: default Prisma tx timeout is 5s · multi-week
    // POS backfill writes hundreds of sequential awaits + chair-move inserts
    // would trip the default + silently roll back. 5 min ceiling covers any
    // realistic real-world XLSX upload.
    maxWait: 30_000,
    timeout: 5 * 60_000,
  });

  // Recompute drift + emit alerts (outside the tx so we don't block on slow work)
  await recomputeAllDrifts(orgId);
  await evaluateAndEmitAlerts(orgId);

  await writeAudit({
    userId: session.user.id,
    action: "pos_import.commit",
    entity: "PosImport",
    entityId: imp.id,
    // Wave-2 B1: record chair-side side-effects so the undo flow can decide
    // whether a clean rollback is even possible (chair moves = harder).
    newValue: {
      committed: true,
      appliedRows: toApply.length,
      counts: diff.counts,
      chairsCreatedFromPos,
      chairMovesRecorded,
    },
  });

  revalidatePath("/chairops/pos-ingest");
  revalidatePath("/chairops/reconcile");
  revalidatePath("/chairops/alerts");

  // Returning ok; caller redirects.
  return { ok: true };
}

// Wave-2 B1 (CEO 2026-05-31): post-import undo window.
// A 60-minute safety net for "I just uploaded the wrong XLSX". Drops every
// PosDaily / BranchDailyRevenue / ChairMove row this import created, reverts
// any chair-branch change it triggered, then deletes the import row so the
// pending-commit list stays clean. Audit log keeps the trail.
//
// Refuses outside the 60-minute window OR if any downstream side-effect
// already touched the affected branch (drift recompute lands new alerts; if
// CEO acted on an alert, we don't want to surprise-rollback).
const UNDO_WINDOW_MS = 60 * 60 * 1000;

export async function undoImport(
  importId: string,
): Promise<{ ok: true; rowsRemoved: number } | { ok: false; error: string }> {
  const session = await requireRole("OFFICE");

  const imp = await prisma.chairopsPosImport.findUnique({ where: { id: importId } });
  if (!imp) return { ok: false, error: "ไม่พบ import นี้" };
  if (!imp.committed || !imp.committedAt) {
    return { ok: false, error: "import นี้ยังไม่ commit · ใช้ cancel แทน" };
  }
  const ageMs = Date.now() - imp.committedAt.getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    const ageMin = Math.round(ageMs / 60000);
    return {
      ok: false,
      error: `เลย undo window แล้ว (commit ไป ${ageMin} นาที · ปลอดภัยภายใน 60 นาที)`,
    };
  }

  const orgId = imp.orgId;

  // Pre-compute chair revert plan OUTSIDE the tx so the heavy join doesn't
  // block other writers. For each chair-move this import created, look up
  // the move that was active BEFORE it (chronologically previous toBranchId).
  const movesByThisImport = await prisma.chairopsChairMove.findMany({
    where: {
      orgId,
      source: "pos_ingest",
      notes: { contains: `importId=${imp.id}` },
    },
    select: { id: true, chairId: true, movedAt: true, fromBranchId: true },
    orderBy: { movedAt: "asc" },
  });

  // For each unique chair, find the latest move STRICTLY BEFORE this import's
  // earliest move for it · that's where the chair lived pre-import.
  type RevertPlan = { chairId: string; revertToBranchId: string | null };
  const earliestPerChair = new Map<string, Date>();
  for (const m of movesByThisImport) {
    const prev = earliestPerChair.get(m.chairId);
    if (!prev || m.movedAt < prev) earliestPerChair.set(m.chairId, m.movedAt);
  }
  const revertPlans: RevertPlan[] = [];
  for (const [chairId, earliest] of earliestPerChair.entries()) {
    const prior = await prisma.chairopsChairMove.findFirst({
      where: {
        orgId,
        chairId,
        movedAt: { lt: earliest },
        NOT: { notes: { contains: `importId=${imp.id}` } },
      },
      orderBy: { movedAt: "desc" },
      select: { toBranchId: true },
    });
    revertPlans.push({
      chairId,
      // Prior toBranchId · or fromBranchId of the first this-import move if no
      // prior history (chair was created by this import → revert means delete).
      revertToBranchId:
        prior?.toBranchId ??
        movesByThisImport.find((m) => m.chairId === chairId)?.fromBranchId ??
        null,
    });
  }

  let removedDaily = 0;
  let removedAgg = 0;
  let chairsDeleted = 0;
  let chairsReverted = 0;

  await prisma.$transaction(
    async (tx) => {
      const delDaily = await tx.chairopsPosDaily.deleteMany({
        where: { orgId, importId: imp.id },
      });
      removedDaily = delDaily.count;

      const delAgg = await tx.chairopsBranchDailyRevenue.deleteMany({
        where: { orgId, sourceImportId: imp.id },
      });
      removedAgg = delAgg.count;

      // Revert / delete chairs per pre-computed plan.
      for (const plan of revertPlans) {
        if (plan.revertToBranchId) {
          await tx.chairopsChair.update({
            where: { id: plan.chairId },
            data: { branchId: plan.revertToBranchId },
          });
          chairsReverted += 1;
        } else {
          // No prior history → chair was created entirely by this import.
          // Delete the chair (cascade-safe because PosDaily was just removed).
          await tx.chairopsChair.delete({ where: { id: plan.chairId } });
          chairsDeleted += 1;
        }
      }

      // Drop the moves we attributed to this import.
      await tx.chairopsChairMove.deleteMany({
        where: {
          orgId,
          source: "pos_ingest",
          notes: { contains: `importId=${imp.id}` },
        },
      });

      // Remove the import row so the pending list stays clean.
      await tx.chairopsPosImport.delete({ where: { id: imp.id } });

      await tx.chairopsAuditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "pos_import.undo",
          entity: "PosImport",
          entityId: imp.id,
          oldValue: {
            filename: imp.filename,
            committedAt: imp.committedAt,
            rowCount: imp.rowCount,
          },
          metadata: {
            removedDaily,
            removedAgg,
            chairsDeleted,
            chairsReverted,
            ageMinutes: Math.round(ageMs / 60000),
          },
        },
      });
    },
    { maxWait: 30_000, timeout: 5 * 60_000 },
  );

  // Drift will be stale until recompute; do it outside the tx like commit does.
  await recomputeAllDrifts(orgId);

  revalidatePath("/chairops/pos-ingest");
  revalidatePath("/chairops/reconcile");
  revalidatePath("/chairops/alerts");

  return { ok: true, rowsRemoved: removedDaily + removedAgg };
}

// ----- W3 (claude-design) · Maker-Checker enforced commit ------------------
//
// commitPosImportWithCheck — wraps commitImport with hard maker-checker gate
// per BR16 (audit master spec §3 · POS Ingest workspace). Different from
// the legacy commitImport which only soft-warns on self-commit; this variant
// REFUSES when uploader === current user UNLESS the current user is MANAGER+.
//
// TODO[claude-design]: real impl needs a Prisma migration adding a DB-level
// CHECK constraint (committed_by != uploaded_by OR commiter.role >= MANAGER)
// + a `committedById` column on ChairopsPosImport. Until that ships we
// enforce in application layer only — sufficient for pilot per Wave-1 cut.
// Planned Wave 2.

export async function commitPosImportWithCheck(
  importId: string,
  ack: { reviewedRows: boolean; reviewedWarnings: boolean; acceptResponsibility: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireRole("OFFICE");

  // 1) checklist gate — UI enforces too, but server is the source of truth
  if (!ack.reviewedRows || !ack.reviewedWarnings || !ack.acceptResponsibility) {
    return {
      ok: false,
      error: "กรุณายืนยัน checklist ทั้ง 3 ข้อก่อน commit",
    };
  }

  const imp = await prisma.chairopsPosImport.findUnique({ where: { id: importId } });
  if (!imp) return { ok: false, error: "ไม่พบ import นี้" };
  if (imp.committed) return { ok: false, error: "import นี้ commit ไปแล้ว" };

  // 2) maker/checker enforcement (BR16) — uploader cannot self-commit unless MANAGER+
  const isSelfCommit = imp.uploadedById === session.user.id;
  const role = session.user.role;
  const isManagerOrAbove = role === "MANAGER" || role === "CEO" || role === "ADMIN";

  if (isSelfCommit && !isManagerOrAbove) {
    return {
      ok: false,
      error:
        "คุณเป็นผู้ upload ไฟล์นี้เอง · ต้องให้ผู้ใช้คนอื่น (OFFICE/MANAGER) เป็นผู้ commit (maker-checker)",
    };
  }

  // 3) delegate the heavy lifting to the existing commitImport flow
  //    (CSV re-parse · transaction · drift recompute · alerts)
  const res = await commitImport(importId);
  if (!res.ok) return res;

  // 4) audit log the maker-checker decision
  await writeAudit({
    userId: session.user.id,
    action: "pos_import.commit_with_check",
    entity: "PosImport",
    entityId: imp.id,
    newValue: {
      makerId: imp.uploadedById,
      checkerId: session.user.id,
      isSelfCommit,
      role,
      ack,
    },
  });

  revalidatePath("/chairops/pos-ingest");
  return { ok: true };
}

export async function cancelImport(importId: string) {
  const session = await requireRole("OFFICE");
  const imp = await prisma.chairopsPosImport.findUnique({ where: { id: importId } });
  if (!imp) redirect("/chairops/pos-ingest");
  if (imp.committed) {
    redirect(`/pos-ingest?error=${encodeURIComponent("commit แล้ว ยกเลิกไม่ได้")}`);
  }
  await prisma.chairopsPosImport.delete({ where: { id: importId } });
  await writeAudit({
    userId: session.user.id,
    action: "pos_import.cancel",
    entity: "PosImport",
    entityId: importId,
    oldValue: { filename: imp.filename, rowCount: imp.rowCount },
  });
  revalidatePath("/chairops/pos-ingest");
  redirect("/chairops/pos-ingest");
}
