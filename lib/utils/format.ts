// Formatters for Thai numbers, currency, dates — Asia/Bangkok everywhere

import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const baht = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("th-TH");

export function formatBaht(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "฿0";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "฿0";
  return baht.format(n);
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "0";
  return number.format(n);
}

export function formatBahtCompact(value: number): string {
  if (value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `฿${(value / 1_000).toFixed(0)}K`;
  return `฿${number.format(value)}`;
}

const thaiDateOpts = "d MMM yy";

export function bkkDate(d: Date | string): string {
  return formatInTimeZone(typeof d === "string" ? new Date(d) : d, TZ, thaiDateOpts);
}

export function bkkDateTime(d: Date | string): string {
  return formatInTimeZone(
    typeof d === "string" ? new Date(d) : d,
    TZ,
    "d MMM yy HH:mm",
  );
}

export function bkkToday(): string {
  return formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
}

export function bkkTime(d: Date | string): string {
  return formatInTimeZone(typeof d === "string" ? new Date(d) : d, TZ, "HH:mm");
}

export function thaiDateLong(d: Date | string): string {
  // 2 พ.ค. 69
  const months = [
    "ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
    "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค.",
  ];
  const dt = typeof d === "string" ? new Date(d) : d;
  const day = parseInt(formatInTimeZone(dt, TZ, "d"), 10);
  const month = parseInt(formatInTimeZone(dt, TZ, "M"), 10) - 1;
  const yearCE = parseInt(formatInTimeZone(dt, TZ, "yyyy"), 10);
  const yearBE = (yearCE + 543) % 100;
  return `${day} ${months[month]} ${String(yearBE).padStart(2, "0")}`;
}
