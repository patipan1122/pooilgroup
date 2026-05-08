// DocuFlow — Telegram expiry alert formatters (pure functions)
// ────────────────────────────────────────────────────────────────────
// Style ตาม buildMorningBrief (lib/telegram/messages.ts):
//   ━━━━━━━━━━━━━━━━━━━━ separator
//   emoji-prefixed lines
//   HTML mode (parseMode: "HTML") — ใช้ htmlEscape สำหรับ user input
//
// Severity tiers (alert_days standard 90/30/7):
//   critical = 0-7 วัน (และเลยกำหนด)
//   urgent   = 8-30 วัน
//   watch    = 31-90 วัน
//
// ────────────────────────────────────────────────────────────────────

import { htmlEscape } from "@/lib/telegram/send";

export interface ExpiryDocItem {
  /** ชื่อเอกสาร (เช่น "ทะเบียนรถ 70-1234") */
  name: string;
  /** Owner label — ทะเบียนรถ / ชื่อคน / ชื่อสาขา */
  owner: string;
  /** "yyyy-MM-dd" — วันหมดอายุ */
  expiryDate: string;
  /** จำนวนวันก่อนหมดอายุ (ติดลบ = เลยมาแล้ว) */
  daysToExpiry: number;
  /** Doc type label (registration / insurance / license / training / ...) */
  docTypeLabel?: string;
}

const fmtDays = (d: number): string => {
  if (d < 0) return `เลยมา ${Math.abs(d)} วัน`;
  if (d === 0) return "หมดอายุวันนี้";
  return `เหลือ ${d} วัน`;
};

const formatDocLine = (item: ExpiryDocItem): string => {
  const parts = [
    `<b>${htmlEscape(item.owner)}</b>`,
    htmlEscape(item.name),
  ];
  if (item.docTypeLabel) parts.push(htmlEscape(item.docTypeLabel));
  return `• ${parts.join(" · ")} — ${fmtDays(item.daysToExpiry)} (${item.expiryDate})`;
};

/* ============================================================
   formatExpiryAlert — generic combined alert (vehicles + persons + branches)
   - Used by morning-brief append
   - Shows critical first (red), urgent next (yellow), watch last (blue)
   ============================================================ */

export function formatExpiryAlert(
  orgName: string,
  criticalDocs: ExpiryDocItem[],
  urgentDocs: ExpiryDocItem[],
  watchDocs: ExpiryDocItem[],
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("📄 <b>DocuFlow — เอกสารใกล้หมดอายุ</b>");
  if (orgName) lines.push(`🏢 ${htmlEscape(orgName)}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  if (criticalDocs.length > 0) {
    lines.push("");
    lines.push(`🔴 <b>วิกฤต — ภายใน 7 วัน</b> (${criticalDocs.length})`);
    criticalDocs.slice(0, 8).forEach((d) => lines.push(formatDocLine(d)));
    if (criticalDocs.length > 8) {
      lines.push(`  ...และอีก ${criticalDocs.length - 8} รายการ`);
    }
  }

  if (urgentDocs.length > 0) {
    lines.push("");
    lines.push(`🟡 <b>เร่งด่วน — ภายใน 30 วัน</b> (${urgentDocs.length})`);
    urgentDocs.slice(0, 6).forEach((d) => lines.push(formatDocLine(d)));
    if (urgentDocs.length > 6) {
      lines.push(`  ...และอีก ${urgentDocs.length - 6} รายการ`);
    }
  }

  if (watchDocs.length > 0) {
    lines.push("");
    lines.push(`🔵 <b>เฝ้าระวัง — ภายใน 90 วัน</b> (${watchDocs.length})`);
    // เฝ้าระวังโชว์น้อย — แค่นับ + 3 ตัวแรก
    watchDocs.slice(0, 3).forEach((d) => lines.push(formatDocLine(d)));
    if (watchDocs.length > 3) {
      lines.push(`  ...และอีก ${watchDocs.length - 3} รายการ`);
    }
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

/* ============================================================
   formatVehicleExpiryAlert — fleet-only summary
   - Use ตอน admin อยากแยกแจ้งเตือนเฉพาะ fleet docs
   ============================================================ */

export function formatVehicleExpiryAlert(
  vehicles: ExpiryDocItem[],
): string {
  const critical = vehicles.filter((v) => v.daysToExpiry <= 7);
  const urgent = vehicles.filter(
    (v) => v.daysToExpiry > 7 && v.daysToExpiry <= 30,
  );
  const watch = vehicles.filter(
    (v) => v.daysToExpiry > 30 && v.daysToExpiry <= 90,
  );

  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("🚛 <b>DocuFlow — เอกสารรถใกล้หมดอายุ</b>");
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  if (vehicles.length === 0) {
    lines.push("");
    lines.push("✅ ไม่มีเอกสารรถใกล้หมดอายุ");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    return lines.join("\n");
  }

  if (critical.length > 0) {
    lines.push("");
    lines.push(`🔴 <b>วิกฤต — ภายใน 7 วัน</b> (${critical.length})`);
    critical.slice(0, 8).forEach((d) => lines.push(formatDocLine(d)));
  }
  if (urgent.length > 0) {
    lines.push("");
    lines.push(`🟡 <b>เร่งด่วน — ภายใน 30 วัน</b> (${urgent.length})`);
    urgent.slice(0, 6).forEach((d) => lines.push(formatDocLine(d)));
  }
  if (watch.length > 0) {
    lines.push("");
    lines.push(`🔵 <b>เฝ้าระวัง — ภายใน 90 วัน</b> (${watch.length})`);
    lines.push(`  รวม ${watch.length} รายการ`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

/* ============================================================
   formatPersonExpiryAlert — driver/staff personal docs
   ============================================================ */

export function formatPersonExpiryAlert(
  personDocs: ExpiryDocItem[],
): string {
  const critical = personDocs.filter((v) => v.daysToExpiry <= 7);
  const urgent = personDocs.filter(
    (v) => v.daysToExpiry > 7 && v.daysToExpiry <= 30,
  );
  const watch = personDocs.filter(
    (v) => v.daysToExpiry > 30 && v.daysToExpiry <= 90,
  );

  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("👤 <b>DocuFlow — เอกสารบุคคลใกล้หมดอายุ</b>");
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  if (personDocs.length === 0) {
    lines.push("");
    lines.push("✅ ไม่มีเอกสารบุคคลใกล้หมดอายุ");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    return lines.join("\n");
  }

  if (critical.length > 0) {
    lines.push("");
    lines.push(`🔴 <b>วิกฤต — ภายใน 7 วัน</b> (${critical.length})`);
    critical.slice(0, 8).forEach((d) => lines.push(formatDocLine(d)));
  }
  if (urgent.length > 0) {
    lines.push("");
    lines.push(`🟡 <b>เร่งด่วน — ภายใน 30 วัน</b> (${urgent.length})`);
    urgent.slice(0, 6).forEach((d) => lines.push(formatDocLine(d)));
  }
  if (watch.length > 0) {
    lines.push("");
    lines.push(`🔵 <b>เฝ้าระวัง — ภายใน 90 วัน</b> (${watch.length})`);
    lines.push(`  รวม ${watch.length} รายการ`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}
