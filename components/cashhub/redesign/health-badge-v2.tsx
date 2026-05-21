// HealthBadge V2 — design's 5-state health pill (growing/steady/watch/new/silent).
// Different from `components/cashhub/charts.tsx#HealthBadge` (grade A-F).
// Reads: pct (latest vs previous period) + current value.
// Used by Dashboard V1 matrix and Heatmap V2 reconcile table.

import { TrendingUp, TrendingDown, Sparkles, Plus, X } from "lucide-react";

export type HealthKind = "growing" | "steady" | "watch" | "new" | "silent";

interface Props {
  kind: HealthKind;
  className?: string;
}

export function inferHealth(cur: number, prev: number): HealthKind {
  if (cur === 0 && prev === 0) return "silent";
  if (cur > 0 && prev === 0) return "new";
  if (prev === 0) return "silent";
  const pct = ((cur - prev) / prev) * 100;
  if (pct >= 15) return "growing";
  if (pct <= -15) return "watch";
  return "steady";
}

const MAP: Record<
  HealthKind,
  { label: string; bg: string; fg: string; Icon: typeof TrendingUp }
> = {
  growing: { label: "เติบโต", bg: "var(--ch-ok-soft)", fg: "#15803d", Icon: TrendingUp },
  steady:  { label: "ทรงตัว", bg: "var(--ch-bg-3)",    fg: "var(--ch-text-2)", Icon: Sparkles },
  watch:   { label: "น่าห่วง", bg: "var(--ch-danger-soft)", fg: "var(--ch-danger)", Icon: TrendingDown },
  new:     { label: "เริ่มกรอก", bg: "var(--ch-info-soft)", fg: "var(--ch-info)", Icon: Plus },
  silent:  { label: "ยังไม่กรอก", bg: "#f1f5f9",       fg: "var(--ch-text-3)", Icon: X },
};

export function HealthBadgeV2({ kind, className }: Props) {
  const m = MAP[kind];
  const { Icon } = m;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className ?? ""}`}
      style={{ background: m.bg, color: m.fg }}
    >
      <Icon className="size-3" strokeWidth={2} />
      {m.label}
    </span>
  );
}
