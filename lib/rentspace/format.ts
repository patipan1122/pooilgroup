// RentSpace — formatting + label helpers (shared web + server)
import { formatBaht, thaiDateLong } from "@/lib/utils/format";

export { formatBaht, thaiDateLong };

const ORG_ID = "00000000-0000-0000-0000-000000000001";
export const POOILGROUP_ORG_ID = ORG_ID;

/** current period YYYY-MM in Asia/Bangkok */
export function currentPeriod(d = new Date()): string {
  const bkk = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${bkk.getFullYear()}-${String(bkk.getMonth() + 1).padStart(2, "0")}`;
}

export function prevPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${TH_MONTHS[m - 1]} ${y + 543}`;
}

export function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

// ===== status labels + token color keys =====
export const UNIT_STATUS: Record<string, { label: string; color: string; soft: string }> = {
  vacant: { label: "ว่าง", color: "var(--rs-vacant)", soft: "var(--rs-vacant-soft)" },
  occupied: { label: "มีผู้เช่า", color: "var(--rs-ok)", soft: "var(--rs-ok-soft)" },
  reserved: { label: "จอง", color: "var(--rs-pending)", soft: "var(--rs-pending-soft)" },
  inactive: { label: "ปิดใช้งาน", color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" },
};

export const CONTRACT_STATUS: Record<string, { label: string; color: string; soft: string }> = {
  draft: { label: "ร่าง", color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" },
  active: { label: "ใช้งาน", color: "var(--rs-ok)", soft: "var(--rs-ok-soft)" },
  expiring: { label: "ใกล้หมดอายุ", color: "var(--rs-pending)", soft: "var(--rs-pending-soft)" },
  expired: { label: "หมดอายุ", color: "var(--rs-danger)", soft: "var(--rs-danger-soft)" },
  terminated: { label: "ยกเลิกแล้ว", color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" },
};

export const BILL_STATUS: Record<string, { label: string; color: string; soft: string }> = {
  draft: { label: "ร่าง", color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" },
  issued: { label: "ออกบิลแล้ว", color: "var(--rs-info)", soft: "var(--rs-info-soft)" },
  partial: { label: "จ่ายบางส่วน", color: "var(--rs-pending)", soft: "var(--rs-pending-soft)" },
  paid: { label: "จ่ายครบ", color: "var(--rs-ok)", soft: "var(--rs-ok-soft)" },
  overdue: { label: "เกินกำหนด", color: "var(--rs-danger)", soft: "var(--rs-danger-soft)" },
  void: { label: "ยกเลิก", color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" },
};

export const DISCOUNT_STATUS: Record<string, { label: string; color: string; soft: string }> = {
  pending: { label: "รออนุมัติ", color: "var(--rs-pending)", soft: "var(--rs-pending-soft)" },
  approved: { label: "อนุมัติแล้ว", color: "var(--rs-ok)", soft: "var(--rs-ok-soft)" },
  rejected: { label: "ไม่อนุมัติ", color: "var(--rs-danger)", soft: "var(--rs-danger-soft)" },
};

export const PAYMENT_METHODS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  qr: "QR / พร้อมเพย์",
  card: "บัตร",
};

export function tenantDisplayName(t: {
  bizName?: string | null;
  prefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
}): string {
  const person = [t.prefix, t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  if (t.bizName && person) return `${t.bizName} (${person})`;
  return t.bizName || person || t.nickname || "ไม่ระบุชื่อ";
}

// ===== จำนวนเงิน → ตัวอักษรไทย (สำหรับสัญญา: "หกหมื่นบาทถ้วน") =====
// self-contained + client-safe · รองรับ 0..999,999,999,999.99 พร้อมสตางค์
const _THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const _THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

function readThaiIntegerGroup(numStr: string): string {
  let out = "";
  const len = numStr.length;
  for (let i = 0; i < len; i++) {
    const digit = Number(numStr[i]);
    const place = len - i - 1;
    if (digit === 0) continue;
    if (place === 0 && digit === 1 && len > 1) out += "เอ็ด";
    else if (place === 1 && digit === 2) out += "ยี่" + _THAI_PLACES[place];
    else if (place === 1 && digit === 1) out += _THAI_PLACES[place];
    else out += _THAI_DIGITS[digit] + _THAI_PLACES[place];
  }
  return out;
}

function readThaiInteger(intStr: string): string {
  const clean = intStr.replace(/^0+(?=\d)/, "");
  if (clean === "0") return _THAI_DIGITS[0];
  if (clean.length > 6) {
    const low = clean.slice(clean.length - 6);
    const high = clean.slice(0, clean.length - 6);
    const highText = readThaiInteger(high) + "ล้าน";
    const lowText = low.replace(/^0+(?=\d)/, "") === "0" ? "" : readThaiIntegerGroup(low.replace(/^0+/, "") || "0");
    return highText + (lowText && lowText !== _THAI_DIGITS[0] ? lowText : "");
  }
  return readThaiIntegerGroup(clean);
}

/** จำนวนเงิน → "หกหมื่นบาทถ้วน" / "...บาท...สตางค์" (สำหรับพิมพ์ในสัญญา) */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const negative = amount < 0;
  const [intPart, satPart] = Math.abs(amount).toFixed(2).split(".");
  const baht = readThaiInteger(intPart);
  const text = Number(satPart) === 0 ? `${baht}บาทถ้วน` : `${baht}บาท${readThaiInteger(satPart)}สตางค์`;
  return (negative ? "ลบ" : "") + text;
}
