// Shared date formatting for the maid activity table + branch popup
// (CEO 2026-08-23) — factored out so both files use the identical
// "days ago" logic instead of drifting apart.

export function bkkDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function bkkYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// CEO 2026-08-23 follow-up: "เพิ่ม column เก็บเงินล่าสุดกี่วันที่แล้ว" — the
// headline signal office staff scan for is "how stale is this", not the exact
// timestamp (kept alongside, smaller, for reference).
export function daysAgoLabel(iso: string): string {
  const then = new Date(iso);
  const todayStart = new Date(`${bkkYmd(new Date())}T00:00:00+07:00`);
  const thenStart = new Date(`${bkkYmd(then)}T00:00:00+07:00`);
  const diffDays = Math.round((todayStart.getTime() - thenStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "วันนี้";
  if (diffDays === 1) return "เมื่อวาน";
  return `${diffDays} วันที่แล้ว`;
}
