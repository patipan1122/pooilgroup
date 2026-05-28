// Sparkbar (ChairOps kit) · 7-day mini bar chart for dense table rows.
// Spec: MOCKUP_SPEC.md §C "Sparkbar" + dashboard.jsx `<Sparkbar />`.
//
// Mockup geometry: each bar 3px wide · 14px tall track · 1.5px gap · status color.
// Bars are normalised to the series max so a flat series still reads as full.
// Pure server component · no client hooks.

import { cn } from "@/lib/utils/cn";

export type SparkbarTone = "critical" | "warn" | "ok" | "neutral";

const TONE_BG: Record<SparkbarTone, string> = {
  critical: "bg-rose-500",
  warn: "bg-amber-500",
  ok: "bg-emerald-500",
  neutral: "bg-zinc-400",
};

export interface SparkbarProps {
  /** Series of non-negative numbers (oldest → newest). */
  series: number[];
  tone?: SparkbarTone;
  className?: string;
}

export function Sparkbar({ series, tone = "neutral", className }: SparkbarProps) {
  const max = Math.max(1, ...series);
  return (
    <div
      className={cn("inline-flex h-[14px] items-end gap-[1.5px]", className)}
      aria-hidden="true"
    >
      {series.map((v, i) => {
        const pct = Math.max(8, Math.round((Math.max(0, v) / max) * 100));
        return (
          <span
            key={i}
            className={cn("w-[3px] rounded-[1px]", TONE_BG[tone])}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}
