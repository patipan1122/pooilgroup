// Small client-safe Thai time formatter for the inbox UI.

/** Relative short Thai time for the conversation list (e.g. "5 นาที", "เมื่อวาน"). */
export function shortThaiTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาที`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "เมื่อวาน";
  if (day < 7) return `${day} วัน`;
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

/** Full Thai datetime for the message thread bubbles. */
export function fullThaiTime(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
