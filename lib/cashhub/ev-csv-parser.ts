// Parse a CSV exported from the PEA VOLTA CONNEXT Looker Studio dashboard
// (right-click charge-session table → Export → CSV) and aggregate into one
// row per (station, date) suitable for DailyReport upsert.
//
// Looker exports Thai column headers. We match by substring (lowercased,
// whitespace-stripped) so small wording differences don't break the parser.

export interface EvCsvRawRow {
  chargerName: string; // "สถานีบจก.พีโออออยล์ สาขา 6 โคกสูง 1 #1"
  startTime: string; // raw ISO-ish string
  kwh: number;
  revenueBaht: number;
}

export interface EvDailyAgg {
  stationName: string; // base name with "#N" suffix stripped
  reportDate: string; // YYYY-MM-DD (Asia/Bangkok)
  sessions: number;
  totalKwh: number;
  totalRevenue: number;
}

export interface ParseResult {
  rows: EvCsvRawRow[];
  aggregates: EvDailyAgg[];
  stations: string[]; // unique base names
  dateRange: { from: string; to: string } | null;
  errors: string[];
  warnings: string[];
}

const HEADER_HINTS = {
  charger: ["ชื่อเครื่องชาร์จ", "charger", "station"],
  start: ["start time", "เริ่ม", "starttime", "start_time"],
  kwh: ["kwh", "พลังงาน", "energy"],
  revenue: ["revenue", "รายได้", "บาท", "baht"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_()]/g, "").trim();
}

function findColumn(headers: string[], hints: string[]): number {
  const normHeaders = headers.map(normalize);
  const normHints = hints.map(normalize);
  for (let i = 0; i < normHeaders.length; i++) {
    for (const hint of normHints) {
      if (normHeaders[i]!.includes(hint)) return i;
    }
  }
  return -1;
}

function stripChargerSuffix(name: string): string {
  // Remove trailing "#1", "#02", "# 3" etc.
  return name.replace(/\s*#\s*\d+\s*$/, "").trim();
}

function parseNumber(s: string): number {
  // Looker exports may use comma thousands separator: "1,234.56"
  const cleaned = s.replace(/[,฿\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toBangkokDate(raw: string): string | null {
  // Accept "2026-05-20 09:18:58", "2026-05-20T09:18:58", "20/05/2026 09:18".
  // Strategy: extract first YYYY-MM-DD or DD/MM/YYYY; do NOT timezone-convert
  // (Looker timestamps are already in dashboard locale = Asia/Bangkok).
  const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slashMatch = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  return null;
}

function parseCsvLine(line: string): string[] {
  // RFC4180-ish: handle quoted fields with embedded commas.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseConnextCsv(csv: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: EvCsvRawRow[] = [];

  // Strip BOM and split lines
  const text = csv.replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    errors.push("ไฟล์ CSV ว่าง หรือมีแค่หัวคอลัมน์");
    return { rows: [], aggregates: [], stations: [], dateRange: null, errors, warnings };
  }

  const headers = parseCsvLine(lines[0]!);
  const idxCharger = findColumn(headers, HEADER_HINTS.charger);
  const idxStart = findColumn(headers, HEADER_HINTS.start);
  const idxKwh = findColumn(headers, HEADER_HINTS.kwh);
  const idxRevenue = findColumn(headers, HEADER_HINTS.revenue);

  if (idxCharger < 0)
    errors.push("ไม่พบคอลัมน์ 'ชื่อเครื่องชาร์จ' / charger");
  if (idxStart < 0) errors.push("ไม่พบคอลัมน์ 'Start Time' / เริ่ม");
  if (idxKwh < 0) errors.push("ไม่พบคอลัมน์ 'kWh' / พลังงาน");
  if (idxRevenue < 0) errors.push("ไม่พบคอลัมน์ 'Revenue' / รายได้");

  if (errors.length > 0) {
    return { rows: [], aggregates: [], stations: [], dateRange: null, errors, warnings };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const charger = cells[idxCharger]?.trim() ?? "";
    const startRaw = cells[idxStart]?.trim() ?? "";
    if (!charger || !startRaw) continue;
    rows.push({
      chargerName: charger,
      startTime: startRaw,
      kwh: parseNumber(cells[idxKwh] ?? "0"),
      revenueBaht: parseNumber(cells[idxRevenue] ?? "0"),
    });
  }

  if (rows.length === 0) {
    warnings.push("อ่านข้อมูลได้ 0 แถว — ตรวจไฟล์อีกครั้ง");
  }

  const aggMap = new Map<string, EvDailyAgg>();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let skippedDate = 0;

  for (const r of rows) {
    const stationName = stripChargerSuffix(r.chargerName);
    const date = toBangkokDate(r.startTime);
    if (!date) {
      skippedDate++;
      continue;
    }
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;

    const key = `${stationName}__${date}`;
    const existing = aggMap.get(key);
    if (existing) {
      existing.sessions += 1;
      existing.totalKwh += r.kwh;
      existing.totalRevenue += r.revenueBaht;
    } else {
      aggMap.set(key, {
        stationName,
        reportDate: date,
        sessions: 1,
        totalKwh: r.kwh,
        totalRevenue: r.revenueBaht,
      });
    }
  }

  if (skippedDate > 0) {
    warnings.push(`อ่านวันที่ไม่ออก ${skippedDate} แถว — ข้ามไป`);
  }

  const aggregates = Array.from(aggMap.values()).sort((a, b) =>
    a.reportDate === b.reportDate
      ? a.stationName.localeCompare(b.stationName, "th")
      : a.reportDate.localeCompare(b.reportDate),
  );
  const stations = Array.from(new Set(aggregates.map((a) => a.stationName))).sort(
    (a, b) => a.localeCompare(b, "th"),
  );

  return {
    rows,
    aggregates,
    stations,
    dateRange: minDate && maxDate ? { from: minDate, to: maxDate } : null,
    errors,
    warnings,
  };
}
