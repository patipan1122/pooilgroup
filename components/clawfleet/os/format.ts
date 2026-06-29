/**
 * ClawOS — pure formatting + status-tone helpers (no "use client" → server-safe).
 * ใช้ร่วมทุกหน้า เพื่อให้สี/รูปแบบเงิน/ธง สอดคล้องกันทั้งโปรแกรม.
 */

/** สตางค์ → "฿1,234" */
export function baht(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "฿0";
  return "฿" + Math.round(cents / 100).toLocaleString("th-TH");
}

/** บาทเต็ม (ไม่ใช่สตางค์) → "฿1,234" */
export function bahtN(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "฿0";
  return "฿" + Math.round(n).toLocaleString("th-TH");
}

/** ตัวเลขล้วน → "1,234" */
export function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return Math.round(n).toLocaleString("th-TH");
}

/** ย่อหลักพัน → "12.3k" สำหรับกราฟ/การ์ดแคบ */
export function compact(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

export type Tone = "brand" | "green" | "red" | "amber" | "neutral" | "dark";

/** สี bg/text/border ต่อ tone — map กลางสำหรับ Pill/Badge/Card */
export const TONE: Record<Tone, { bg: string; text: string; border: string; soft: string }> = {
  brand: { bg: "#EEF0FE", text: "#4F46E5", border: "#D9DBFB", soft: "#EEF0FE" },
  green: { bg: "#E7F4EC", text: "#15803D", border: "#CDE9D7", soft: "#F2FAF5" },
  red: { bg: "#FCEDEC", text: "#B42318", border: "#F3D9D5", soft: "#FFF9F8" },
  amber: { bg: "#FCF1E2", text: "#B45309", border: "#F0E2BE", soft: "#FCF8EC" },
  neutral: { bg: "#F1F2F7", text: "#5A6270", border: "#E3E6EA", soft: "#F8F9FB" },
  dark: { bg: "#1E2230", text: "#FFFFFF", border: "#1E2230", soft: "#1B1E2A" },
};

/** P&L flag (จาก pnl-queries) → tone + label สั้น ๆ ภาษาคน
 * band: avg บาท/ตุ๊กตา 180–280 = กำลังดี · <180 = ออกง่ายไป · 280–350 = แพง · >350 = ยากไป */
export type PnlFlagKey = "LOW" | "GOOD" | "AMBER" | "HIGH" | "LOSS" | "NODATA";
export function pnlTone(flag: PnlFlagKey): { tone: Tone; label: string } {
  switch (flag) {
    case "GOOD": return { tone: "green", label: "กำลังดี" };
    case "LOW": return { tone: "amber", label: "ออกง่ายไป" };
    case "AMBER": return { tone: "amber", label: "เริ่มแพง" };
    case "HIGH": return { tone: "red", label: "ยากไป" };
    case "LOSS": return { tone: "red", label: "ขาดทุน" };
    default: return { tone: "neutral", label: "ไม่มีข้อมูล" };
  }
}

/** ตำแหน่ง marker บนแถบสุขภาพการตั้งค่าตู้ (฿60 ง่ายไป → ฿300 ยากไป) */
export function avgWinMarkerPct(avg: number): string {
  const min = 60, max = 300;
  const clamped = Math.max(min, Math.min(max, avg));
  return (((clamped - min) / (max - min)) * 100).toFixed(1) + "%";
}

/** สีตัวเลขกำไร/ส่วนต่าง: + เขียว, − แดง, 0 เทา */
export function deltaColor(n: number): string {
  if (n > 0) return "#15803D";
  if (n < 0) return "#B42318";
  return "#6B7280";
}

/** วันที่ไทยสั้น "24 มิ.ย." */
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export function thDate(d: Date): string { return d.getDate() + " " + TH_MON[d.getMonth()]; }
export function thWeekday(d: Date): string { return TH_WD[d.getDay()]; }
export { TH_MON, TH_WD };
