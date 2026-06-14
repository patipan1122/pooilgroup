// CashHub Hotel — อ่านไฟล์ธนาคาร TTB Smart Shop QR (รหัส "3468") = QR เงินเข้าจริง
//
// ธนาคารตัดยอด QR ตาม Payment Date (วันปฏิทิน) → group Success ตามวัน = QR เข้าบัญชีจริงต่อวัน
// แก้ปัญหา QR ตัดเที่ยงคืน (กะดึกคร่อมเที่ยงคืน — QR หลังเที่ยงคืนเข้าบัญชีวันถัดไป).
// รับทั้ง CSV และ xlsx (แปลงเป็น matrix ก่อนเรียก parseTtbQr).

type Cell = string | number | null | undefined;

const txt = (v: Cell) => (v == null ? "" : String(v).trim());

function amount(v: Cell): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/[, "]/g, "").trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** DD/MM/YYYY → YYYY-MM-DD (รับ 2026 ค.ศ. ตามไฟล์ TTB) */
function toIsoDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export type TtbQrResult = {
  byDate: Record<string, number>; // YYYY-MM-DD → ยอด QR Success รวมของวันนั้น
  total: number;
  successCount: number;
  skipped: number; // รายการที่ไม่ใช่ Success (Expired/Cancelled/Voided)
  error?: string;
};

/**
 * @param matrix แถวเซลล์จากไฟล์ TTB (csv split หรือ xlsx sheet_to_json header:1)
 */
export function parseTtbQr(matrix: Cell[][]): TtbQrResult {
  const empty: TtbQrResult = { byDate: {}, total: 0, successCount: 0, skipped: 0 };
  // หาแถว header (มี Transaction ID + Payment Date + Status)
  let headerRow = -1;
  const col: Record<string, number> = {};
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const r = matrix[i].map((c) => txt(c).toLowerCase());
    const idxDate = r.findIndex((c) => c.includes("payment date"));
    const idxAmt = r.findIndex((c) => c.includes("payment amount"));
    const idxStatus = r.findIndex((c) => c.includes("transaction status") || c === "status");
    if (idxDate >= 0 && idxAmt >= 0 && idxStatus >= 0) {
      headerRow = i;
      col.date = idxDate;
      col.amount = idxAmt;
      col.status = idxStatus;
      break;
    }
  }
  if (headerRow < 0)
    return { ...empty, error: "ไม่พบหัวตาราง TTB (Payment Date/Amount/Status)" };

  const byDate: Record<string, number> = {};
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
    const iso = toIsoDate(txt(r[col.date]));
    if (!iso) continue;
    const amt = amount(r[col.amount]);
    byDate[iso] = (byDate[iso] ?? 0) + amt;
    total += amt;
    successCount++;
  }
  if (successCount === 0)
    return { ...empty, skipped, error: "ไม่พบรายการ Success ในไฟล์" };
  return { byDate, total, successCount, skipped };
}
