// DocuFlow expiry helpers — pure functions, no I/O
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §6 (Expiry Dashboard)
//
// Severity buckets:
//   expired   — already past expiry (days < 0)
//   critical  — within 7 days
//   urgent    — within 30 days
//   watch     — within 90 days
//   normal    — > 90 days
// ────────────────────────────────────────────────────────────────────

export type ExpiryStatus =
  | "expired"
  | "critical"
  | "urgent"
  | "watch"
  | "normal";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Days from "now" until `date`. Negative = expired.
 * Compares at calendar-day resolution in UTC (avoid TZ drift on
 * Date columns stored as @db.Date).
 */
export function daysUntilExpiry(date: Date | string): number {
  const expiry = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const expiryUtc = Date.UTC(
    expiry.getUTCFullYear(),
    expiry.getUTCMonth(),
    expiry.getUTCDate(),
  );
  const nowUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((expiryUtc - nowUtc) / MS_PER_DAY);
}

export function getExpiryStatus(date: Date | string): ExpiryStatus {
  const days = daysUntilExpiry(date);
  if (days < 0) return "expired";
  if (days <= 7) return "critical";
  if (days <= 30) return "urgent";
  if (days <= 90) return "watch";
  return "normal";
}

/**
 * Group items by expiry status. Each item must have an `expiryDate`.
 * Returns a record keyed by status.
 */
export function groupByExpiryStatus<T extends { expiryDate: Date | string }>(
  items: T[],
): Record<ExpiryStatus, T[]> {
  const buckets: Record<ExpiryStatus, T[]> = {
    expired: [],
    critical: [],
    urgent: [],
    watch: [],
    normal: [],
  };
  for (const item of items) {
    const s = getExpiryStatus(item.expiryDate);
    buckets[s].push(item);
  }
  return buckets;
}

/**
 * Order: expired → critical → urgent → watch → normal.
 * Useful for sorting lists so the most urgent appears first.
 */
export const EXPIRY_STATUS_RANK: Record<ExpiryStatus, number> = {
  expired: 0,
  critical: 1,
  urgent: 2,
  watch: 3,
  normal: 4,
};
