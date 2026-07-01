// ClawFleet · ตู้คีบ OS — CSV builder (pure · ไม่พึ่ง browser).
// ใช้ร่วมกันหลายทีม (reports / collections / stock) เป็น single source ของการทำ CSV.
//
// - ใส่ UTF-8 BOM (﻿) นำหน้าเสมอ → Excel เปิดภาษาไทยไม่กลายเป็นตัวประหลาด.
// - escape ตาม RFC 4180: ค่าที่มี , " หรือขึ้นบรรทัดใหม่ → ครอบด้วย " และ escape " เป็น "".
// - null / undefined → ช่องว่าง. number/boolean → toString ปกติ.
// - ขึ้นบรรทัดด้วย \r\n (Excel/Windows-friendly).
//
// pure function: รับ headers + rows → คืน string. ฝั่งเรียกเอาไปทำ Blob download เอง.

export type CsvHeader = { key: string; label: string };

/** escape ค่าเดียวให้ปลอดภัยสำหรับ CSV cell */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  // ต้องครอบ quote เมื่อมี comma / double-quote / ขึ้นบรรทัด (\n หรือ \r)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * สร้างสตริง CSV จาก headers (ลำดับคอลัมน์ + ป้ายหัวตาราง) และ rows.
 * แต่ละ row = object ที่ดึงค่าตาม header.key. คีย์ที่ไม่มีใน row → ช่องว่าง.
 */
export function buildCsv(headers: CsvHeader[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map((h) => escapeCell(h.label)).join(",");
  const bodyLines = rows.map((row) =>
    headers.map((h) => escapeCell(row[h.key])).join(","),
  );
  // BOM นำหน้าเพื่อให้ Excel รู้ว่าเป็น UTF-8
  return "﻿" + [headerLine, ...bodyLines].join("\r\n");
}
