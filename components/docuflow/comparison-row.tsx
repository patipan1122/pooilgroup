// DocuFlow · ComparisonRow — single old-vs-new line for renewal comparison
// ────────────────────────────────────────────────────────────────────
// Server component. Renders one row of the comparison table:
//
//   [label .....]  oldValue  →  newValue   +14.6% ⚠️
//
// Severity rule (HARD):
//   percentChange ≤ 0 (same/down)  → success green
//   0 < pct ≤ 10                   → warning yellow
//   pct > 10                       → danger red
//
// Numbers are formatted with formatBaht when `currency` is true.
// String values (e.g. "กรุงไทย") are passed through verbatim.
// ────────────────────────────────────────────────────────────────────

import { ArrowRight } from "lucide-react";
import { formatBaht, formatNumber } from "@/lib/utils/format";

export type ComparisonSeverity = "same" | "down" | "small-up" | "big-up";

export interface ComparisonRowProps {
  label: string;
  oldValue: number | string | null | undefined;
  newValue: number | string | null | undefined;
  /** Format both values as ฿ baht when both are numbers */
  currency?: boolean;
  /** Suffix on numeric values when not currency (e.g. "เดือน", "ปี") */
  unit?: string;
}

/** Pick a severity bucket based on percent change. */
function classify(pct: number): ComparisonSeverity {
  if (pct === 0) return "same";
  if (pct < 0) return "down";
  if (pct <= 10) return "small-up";
  return "big-up";
}

const SEVERITY_TONE: Record<ComparisonSeverity, string> = {
  same: "text-zinc-500",
  down: "text-green-600",
  "small-up": "text-amber-600",
  "big-up": "text-red-600",
};

const SEVERITY_LABEL: Record<ComparisonSeverity, string> = {
  same: "เท่าเดิม",
  down: "",
  "small-up": "",
  "big-up": "",
};

const SEVERITY_ICON: Record<ComparisonSeverity, string> = {
  same: "",
  down: "▼",
  "small-up": "▲",
  "big-up": "▲",
};

function fmt(
  v: number | string | null | undefined,
  currency: boolean,
  unit?: string,
): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (currency) return formatBaht(v);
    return unit ? `${formatNumber(v)} ${unit}` : formatNumber(v);
  }
  return v;
}

export function ComparisonRow({
  label,
  oldValue,
  newValue,
  currency = false,
  unit,
}: ComparisonRowProps) {
  const oldNum = typeof oldValue === "number" ? oldValue : null;
  const newNum = typeof newValue === "number" ? newValue : null;

  let severity: ComparisonSeverity = "same";
  let pctText = "";

  if (oldNum !== null && newNum !== null && oldNum > 0) {
    const pct = ((newNum - oldNum) / oldNum) * 100;
    severity = classify(pct);
    if (severity !== "same") {
      const sign = pct > 0 ? "+" : "";
      pctText = `${sign}${pct.toFixed(1)}%`;
    }
  } else if (oldValue !== newValue) {
    // String values that differ — neutral "เปลี่ยน"
    severity =
      typeof oldValue === "string" && typeof newValue === "string"
        ? "small-up"
        : "same";
  }

  const oldText = fmt(oldValue, currency, unit);
  const newText = fmt(newValue, currency, unit);

  const pctNode =
    severity === "same" ? (
      SEVERITY_LABEL.same
    ) : pctText ? (
      <>
        <span className="mr-0.5">{SEVERITY_ICON[severity]}</span>
        {pctText}
      </>
    ) : (
      "เปลี่ยน"
    );

  return (
    <div className="flex flex-col gap-1 py-3 border-b border-zinc-100 last:border-0 sm:grid sm:grid-cols-12 sm:gap-2 sm:py-2 sm:items-center">
      {/* Label */}
      <p className="text-sm text-zinc-700 sm:col-span-4">{label}</p>

      {/* Mobile: ฉบับเก่า → ฉบับใหม่ stacked with mini-labels.
          Desktop: separate columns with arrow between. */}
      <div className="flex items-center gap-2 sm:hidden">
        <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-400 font-bold w-14 shrink-0">
          ฉบับเก่า
        </span>
        <span className="text-sm text-zinc-500 tabular-nums">{oldText}</span>
      </div>
      <div className="flex items-center gap-2 sm:hidden">
        <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-400 font-bold w-14 shrink-0">
          ฉบับใหม่
        </span>
        <span className="text-sm font-medium text-zinc-900 tabular-nums">
          {newText}
        </span>
        <span
          className={`ml-auto text-xs font-semibold tabular-nums ${SEVERITY_TONE[severity]}`}
        >
          {pctNode}
        </span>
      </div>

      {/* Desktop columns */}
      <p className="hidden sm:block sm:col-span-3 text-sm text-zinc-500 tabular-nums truncate">
        {oldText}
      </p>
      <ArrowRight className="hidden sm:block sm:col-span-1 size-3.5 text-zinc-300" />
      <p className="hidden sm:block sm:col-span-2 text-sm font-medium text-zinc-900 tabular-nums truncate">
        {newText}
      </p>
      <p
        className={`hidden sm:block sm:col-span-2 text-xs font-semibold tabular-nums text-right ${SEVERITY_TONE[severity]}`}
      >
        {pctNode}
      </p>
    </div>
  );
}
