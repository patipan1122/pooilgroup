// CashHub Hotel — อ่านไฟล์ธนาคาร TTB Smart Shop QR (รหัส "3468") = QR เงินเข้าจริง
//
// ธนาคารตัดยอด QR ตาม Payment Date (วันปฏิทิน) → group Success ตามวัน = QR เข้าบัญชีจริงต่อวัน
// แก้ปัญหา QR ตัดเที่ยงคืน (กะดึกคร่อมเที่ยงคืน — QR หลังเที่ยงคืนเข้าบัญชีวันถัดไป).
// รับทั้ง CSV และ xlsx (แปลงเป็น matrix ก่อนเรียก parseTtbQr).

type Cell = string | number | null | undefined;

/** parse CSV เป็น matrix แบบ state-machine — รองรับ field มี comma/quote/newline ในเครื่องหมายคำพูด
 *  (XLSX.read บางทีตัดจบกลางทางถ้าไฟล์มี newline ใน quoted field → ใช้ตัวนี้แทนสำหรับ .csv) */
export function csvToMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, ""); // ตัด BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true; // เปิดโหมด quote เฉพาะตอนต้น field (RFC4180) — quote กลาง field = ตัวอักษรปกติ
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const txt = (v: Cell) => (v == null ? "" : String(v).trim());

function amount(v: Cell): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/[, "]/g, "").trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// 🔑 ธนาคาร TTB ตัดยอดเข้าบัญชีที่ 23:00 ("BP Auto 23:00") — รายการ QR ที่สแกน
// ตั้งแต่ 23:00 เป็นต้นไป จะไปเข้าบัญชี "วันถัดไป" (verified 29/30 วันตรงยอด statement)
const SETTLE_CUTOFF_MIN = 23 * 60; // 23:00
// 🌙 กะดึกโรงแรมจบ 07:00 — QR สแกนช่วง 00:00–07:00 = ของกะคืน "วันก่อน" (CEO 2026-06-14)
const OVERNIGHT_END_MIN = 7 * 60; // 07:00
// ⏰ QR สแกน 23:00–00:00 (ก่อนเที่ยงคืน) → ธนาคารตัด 23:00 ดันเข้าบัญชี "วันถัดไป"
const LATE_START_MIN = 23 * 60; // 23:00

function timeMins(rawTime: string): number {
  const tm = rawTime.trim().match(/^(\d{1,2}):(\d{2})/);
  return tm ? Number(tm[1]) * 60 + Number(tm[2]) : 0;
}

/** DD/MM/YYYY → YYYY-MM-DD (วันสแกนจริง · ไม่ตัด cutoff) */
function scanDate(rawDate: string): string | null {
  const m = rawDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).toISOString().slice(0, 10);
}

/** DD/MM/YYYY + เวลา → วันที่เข้าบัญชีจริง (YYYY-MM-DD) ตาม cutoff 23:00 */
function bankDate(rawDate: string, rawTime: string): string | null {
  const iso = scanDate(rawDate);
  if (!iso) return null;
  let dt = new Date(`${iso}T00:00:00Z`);
  if (timeMins(rawTime) >= SETTLE_CUTOFF_MIN) dt = new Date(dt.getTime() + 86400000); // +1 วัน
  return dt.toISOString().slice(0, 10);
}

// overnight = 00:00–07:00 (กะคืนวันก่อน) · late = 23:00–00:00 (ธนาคารดันไปวันถัดไป)
export type ScanBand = { total: number; overnight: number; late: number };

export type TtbQrResult = {
  byDate: Record<string, number>; // วันเข้าบัญชี (ตัด 23:00) → ยอด QR Success — เทียบ statement ธนาคาร
  byScanDate: Record<string, ScanBand>; // วันสแกนจริง → {รวมทั้งวัน, ช่วง 00:00–07:00} — ใช้คิดฐานกะ
  total: number;
  successCount: number;
  skipped: number; // รายการที่ไม่ใช่ Success (Expired/Cancelled/Voided)
  error?: string;
};

/**
 * @param matrix แถวเซลล์จากไฟล์ TTB (csv split หรือ xlsx sheet_to_json header:1)
 */
export function parseTtbQr(matrix: Cell[][]): TtbQrResult {
  const empty: TtbQrResult = {
    byDate: {},
    byScanDate: {},
    total: 0,
    successCount: 0,
    skipped: 0,
  };
  // หาแถว header (มี Transaction ID + Payment Date + Status)
  let headerRow = -1;
  const col: Record<string, number> = {};
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const r = matrix[i].map((c) => txt(c).toLowerCase());
    const idxDate = r.findIndex((c) => c.includes("payment date"));
    const idxTime = r.findIndex((c) => c.includes("payment time"));
    const idxAmt = r.findIndex((c) => c.includes("payment amount"));
    const idxStatus = r.findIndex((c) => c.includes("transaction status") || c === "status");
    if (idxDate >= 0 && idxAmt >= 0 && idxStatus >= 0) {
      headerRow = i;
      col.date = idxDate;
      col.time = idxTime; // อาจ -1 ถ้าไม่มี (จะถือเป็น 00:00)
      col.amount = idxAmt;
      col.status = idxStatus;
      break;
    }
  }
  if (headerRow < 0)
    return { ...empty, error: "ไม่พบหัวตาราง TTB (Payment Date/Amount/Status)" };

  const byDate: Record<string, number> = {};
  const byScanDate: Record<string, ScanBand> = {};
  let total = 0,
    successCount = 0,
    skipped = 0;
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const r = matrix[i];
    const status = txt(r[col.status]);
    if (!status) continue; // แถวว่าง/summary
    if (status.toLowerCase() !== "success") {
      if (txt(r[col.date])) skipped++;
      continue;
    }
    const rawDate = txt(r[col.date]);
    const rawTime = col.time >= 0 ? txt(r[col.time]) : "";
    const iso = bankDate(rawDate, rawTime); // วันเข้าบัญชี (ตัด 23:00)
    const sIso = scanDate(rawDate); // วันสแกนจริง
    if (!iso || !sIso) continue;
    const amt = amount(r[col.amount]);
    byDate[iso] = (byDate[iso] ?? 0) + amt;
    const band = (byScanDate[sIso] ??= { total: 0, overnight: 0, late: 0 });
    const mins = timeMins(rawTime);
    band.total += amt;
    if (mins < OVERNIGHT_END_MIN) band.overnight += amt; // 00:00–07:00 = กะคืนวันก่อน
    if (mins >= LATE_START_MIN) band.late += amt; // 23:00–00:00 = ธนาคารดันไปวันถัดไป
    total += amt;
    successCount++;
  }
  if (successCount === 0)
    return { ...empty, skipped, error: "ไม่พบรายการ Success ในไฟล์" };
  return { byDate, byScanDate, total, successCount, skipped };
}
