// ShortageDriftCell · ChairOps signature pattern (Plan K cumulative drift)
// Spec: AUDIT_chairops_2026-05-25 §6.shortage tokens
//
// Displays drift amount with cumulative-days badge + age badge + optional
// escalation tier (MGR/CEO). Used in reconcile list rows + branch detail.
// SERVER-FRIENDLY · no client hooks · pure presentational.
//
// Rules (per [[section-component-eyebrow-rootcause]]):
//   - NO uppercase · NO tracking on Thai
//   - tabular-nums on the number
//   - Solid bg on badges (NEVER /20 /30 translucent)

import { cn } from "@/lib/utils/cn";

export type EscalationTier = "none" | "mgr" | "ceo";

export interface ShortageDriftCellProps {
  /** Drift amount in THB. Negative = shortage, positive = surplus, 0 = balanced. */
  amount: number;
  /** Number of consecutive days the drift has persisted (Plan K cumulative). */
  cumulativeDays?: number;
  /** Age of the oldest unresolved drift entry, hours. */
  ageHours?: number;
  /** Escalation tier — auto-calculated by caller from age/amount thresholds. */
  escalation?: EscalationTier;
  /** When true, prepend the row-left red stripe (table-row use). */
  withLeftStripe?: boolean;
  /** Compact mode for dense tables (hides cumulative+age unless > 0). */
  compact?: boolean;
  className?: string;
}

function formatTHB(amount: number): string {
  const sign = amount < 0 ? "-" : amount > 0 ? "+" : "";
  return `${sign}${Math.abs(amount).toLocaleString("th-TH")}`;
}

function formatAge(hours: number): string {
  if (hours < 1) return "ใหม่";
  if (hours < 24) return `${Math.floor(hours)} ชม.`;
  const days = Math.floor(hours / 24);
  return `${days} วัน`;
}

export function ShortageDriftCell({
  amount,
  cumulativeDays = 0,
  ageHours = 0,
  escalation = "none",
  withLeftStripe = false,
  compact = false,
  className,
}: ShortageDriftCellProps) {
  const isShortage = amount < 0;
  const isBalanced = amount === 0;
  const numberClass = isShortage
    ? "text-rose-600 font-bold tabular-nums text-base"
    : isBalanced
      ? "text-zinc-500 font-medium tabular-nums text-base"
      : "text-emerald-700 font-semibold tabular-nums text-base";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        withLeftStripe && isShortage && "border-l-4 border-rose-500 pl-2",
        className,
      )}
    >
      <span className={numberClass}>
        {formatTHB(amount)}
        <span className="ml-1 text-xs font-medium text-zinc-500">บาท</span>
      </span>
      {/* CEO 2026-06-01: add explicit label so "−22,761" doesn't read as
          surplus when it's actually shortage in cell-convention (cell:
          amount<0 = shortage; drift-engine: amount>0 = shortage; consumers
          flip the sign). The label makes the meaning unambiguous. */}
      <span
        className={cn(
          "rounded px-1 py-0.5 text-[11px] font-medium",
          isShortage
            ? "bg-rose-50 text-rose-700"
            : isBalanced
              ? "bg-zinc-50 text-zinc-600"
              : "bg-emerald-50 text-emerald-700",
        )}
      >
        {isShortage ? "ค้างฝาก" : isBalanced ? "พอดี" : "ฝากเกิน"}
      </span>

      {(!compact || cumulativeDays > 0) && cumulativeDays > 0 && (
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
          ขาดสะสม {cumulativeDays.toLocaleString("th-TH")} วัน
        </span>
      )}

      {(!compact || ageHours > 0) && ageHours > 0 && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
          อายุ {formatAge(ageHours)}
        </span>
      )}

      {escalation === "mgr" && (
        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 ring-1 ring-violet-300">
          แจ้งผู้จัดการ
        </span>
      )}
      {escalation === "ceo" && (
        <span className="animate-pulse rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-900 ring-1 ring-rose-400">
          แจ้ง CEO
        </span>
      )}
    </div>
  );
}
