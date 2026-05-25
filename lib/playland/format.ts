// Playland · Display formatters

export function thb(cents: number): string {
  return `฿${(cents / 100).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function thbShort(cents: number): string {
  const v = cents / 100;
  if (v >= 1_000_000) return `฿${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `฿${(v / 1_000).toFixed(1)}k`;
  return `฿${v.toLocaleString("th-TH")}`;
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "หมด";
  if (seconds >= 999_000) return "ไม่จำกัด";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtElapsed(checkInAt: Date | string): string {
  const ms = Date.now() - new Date(checkInAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} ชม. ${m} นาที`;
}

export function memberTypeLabel(t: string): string {
  return ({
    KID: "เด็ก",
    PARENT: "ผู้ปกครอง",
    STAFF: "พนักงาน",
    CLEANER: "แม่บ้าน",
    VIP: "VIP",
    BABYSITTER: "พี่เลี้ยง",
    GUEST: "ทั่วไป",
  })[t] || t;
}

export function sessionStatusLabel(s: string): string {
  return ({
    ACTIVE: "กำลังเล่น",
    PAUSED: "พักออก",
    COMPLETED: "ออกแล้ว",
    EXPIRED: "หมดเวลา",
    FORFEITED: "ขาดสิทธิ์",
    CANCELLED: "ยกเลิก",
  })[s] || s;
}

export function sessionStatusChipClass(s: string): string {
  return ({
    ACTIVE: "pl-chip pl-chip-ok",
    PAUSED: "pl-chip pl-chip-warn",
    COMPLETED: "pl-chip pl-chip-muted",
    EXPIRED: "pl-chip pl-chip-danger",
    FORFEITED: "pl-chip pl-chip-danger",
    CANCELLED: "pl-chip pl-chip-muted",
  })[s] || "pl-chip pl-chip-muted";
}

export function bookingStatusLabel(s: string): string {
  return ({
    PENDING: "รอชำระเงิน",
    PAID: "ชำระแล้ว · รอ check-in",
    CHECKED_IN: "เข้ามาแล้ว",
    CANCELLED: "ยกเลิก",
    EXPIRED: "หมดอายุ",
    NO_SHOW: "ไม่มาตามนัด",
  })[s] || s;
}

export function bookingStatusChipClass(s: string): string {
  return ({
    PENDING: "pl-chip pl-chip-warn",
    PAID: "pl-chip pl-chip-ok",
    CHECKED_IN: "pl-chip pl-chip-info",
    CANCELLED: "pl-chip pl-chip-muted",
    EXPIRED: "pl-chip pl-chip-danger",
    NO_SHOW: "pl-chip pl-chip-danger",
  })[s] || "pl-chip pl-chip-muted";
}

export function deviceStatusChipClass(s: string): string {
  return ({
    ONLINE: "pl-chip pl-chip-ok",
    OFFLINE: "pl-chip pl-chip-danger",
    ERROR: "pl-chip pl-chip-danger",
    PAIRING: "pl-chip pl-chip-warn",
    DISABLED: "pl-chip pl-chip-muted",
  })[s] || "pl-chip pl-chip-muted";
}

export function alertSeverityChipClass(s: string): string {
  return ({
    INFO: "pl-chip pl-chip-info",
    WARNING: "pl-chip pl-chip-warn",
    DANGER: "pl-chip pl-chip-danger",
  })[s] || "pl-chip pl-chip-muted";
}

export function packageTypeLabel(t: string): string {
  return ({
    FIXED: "เหมารอบ",
    PER_MINUTE: "คิดนาที",
    DAY_PASS: "Day Pass",
  })[t] || t;
}

export function packageLabel(p: { name: string; type: string; minutes: number | null; price: number }): string {
  if (p.type === "DAY_PASS") return `${p.name} · ทั้งวัน · ${thb(p.price)}`;
  if (p.type === "PER_MINUTE") return `${p.name} · ${thb(p.price)}/นาที`;
  return `${p.name} · ${p.minutes ?? 0} นาที · ${thb(p.price)}`;
}
