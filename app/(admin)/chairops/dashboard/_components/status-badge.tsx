// Status badge for branch rows · color-coded by drift/collection state
// No 'use client' · purely presentational
import { Badge } from "@/components/ui/badge";

export type BranchStatus = "ok" | "watch" | "shortage" | "surplus" | "missed" | "inactive";

const STATUS_LABEL: Record<BranchStatus, string> = {
  ok: "ปกติ",
  watch: "เฝ้าระวัง",
  shortage: "เงินขาด",
  surplus: "เกิน",
  missed: "ไม่ส่งยอด",
  inactive: "ปิดสาขา",
};

const STATUS_TONE: Record<BranchStatus, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success",
  watch: "warning",
  shortage: "danger",
  surplus: "warning",
  missed: "danger",
  inactive: "neutral",
};

export function StatusBadge({ status }: { status: BranchStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/**
 * Derive status from a dashboard row (mirrors drift-engine logic but is purely
 * derived from the snapshot — keeps UI in sync without re-reading DB).
 */
export function deriveStatus(args: {
  isActive: boolean;
  driftAmount: number;
  driftHours: number;
  daysSinceLastCollection: number;
}): BranchStatus {
  if (!args.isActive) return "inactive";
  if (args.daysSinceLastCollection > 1) return "missed";
  if (args.driftAmount > 0 && args.driftHours >= 24) return "shortage";
  if (args.driftAmount < -100) return "surplus";
  if (args.driftAmount > 0) return "watch";
  return "ok";
}

/** "12 ชม." | "3 วัน 4 ชม." | "—" */
export function formatAgeThai(hours: number): string {
  if (!hours || hours <= 0) return "—";
  if (hours < 24) return `${hours} ชม.`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  if (rem === 0) return `${days} วัน`;
  return `${days} วัน ${rem} ชม.`;
}
