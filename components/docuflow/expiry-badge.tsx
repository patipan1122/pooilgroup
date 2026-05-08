// ExpiryBadge — visual countdown for document_renewals
// ────────────────────────────────────────────────────────────────────
// Tone mapping per DESIGN_SYSTEM.md:
//   expired  → danger (already past)
//   critical → danger (≤ 7 days — must act now)
//   urgent   → warning (≤ 30 days — schedule renewal)
//   watch    → neutral (≤ 90 days — start preparing)
//   normal   → success (> 90 days — healthy)
// ────────────────────────────────────────────────────────────────────

import { Badge } from "@/components/ui/badge";
import type { ExpiryStatus } from "@/lib/docuflow/expiry";

interface Props {
  status: ExpiryStatus;
  /** Days from now until expiry. Negative = past. */
  days: number;
  className?: string;
}

const TONE_BY_STATUS: Record<
  ExpiryStatus,
  "danger" | "warning" | "neutral" | "success"
> = {
  expired: "danger",
  critical: "danger",
  urgent: "warning",
  watch: "neutral",
  normal: "success",
};

export function ExpiryBadge({ status, days, className }: Props) {
  let label: string;
  if (days < 0) {
    label = `หมดแล้ว ${Math.abs(days)} วัน`;
  } else if (days === 0) {
    label = "หมดวันนี้";
  } else {
    label = `เหลือ ${days} วัน`;
  }

  return (
    <Badge tone={TONE_BY_STATUS[status]} className={className}>
      {label}
    </Badge>
  );
}
