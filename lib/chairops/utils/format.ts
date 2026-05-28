import { format } from "date-fns";
import { th } from "date-fns/locale";
import { toZonedTime } from "date-fns-tz";

export const TZ = process.env.APP_TIMEZONE || "Asia/Bangkok";

/** Long Thai date with weekday — e.g. "วันพุธ 27 พ.ค. 2026" (mockup header). */
export function thaiDateLong(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const zoned = toZonedTime(date, TZ);
  return `วัน${format(zoned, "EEEE d MMM yyyy", { locale: th })}`;
}

export function baht(n: number | null | undefined, withSign = false): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : withSign && n > 0 ? "+" : "";
  return `${sign}${abs.toLocaleString("en-US")} ฿`;
}

export function thaiDate(d: Date | string, fmt = "d MMM yy"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return format(toZonedTime(date, TZ), fmt);
}

export function thaiDateTime(d: Date | string): string {
  return thaiDate(d, "d MMM yy HH:mm");
}

export function thaiRelative(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const now = Date.now();
  const diff = (now - date.getTime()) / 1000;
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีก่อน`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชม.ก่อน`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} วันก่อน`;
  return thaiDate(date);
}

export function ageHours(d: Date | string): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.floor((Date.now() - date.getTime()) / 3600_000);
}

export function ageDays(d: Date | string): number {
  return Math.floor(ageHours(d) / 24);
}
