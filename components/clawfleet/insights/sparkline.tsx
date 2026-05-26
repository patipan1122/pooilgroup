// Tiny SVG sparkline — pure SVG, no recharts.
// Per audit §6.7 and FE-D8: no chart library; analytical color = indigo from tokens.
// Reusable kit primitive — placed under /insights for ownership clarity (Workspace 3).
//
// Usage:
//   <Sparkline data={[12, 14, 9, 18, 22, 19, 25]} tone="indigo" />

import { cn } from "@/lib/utils/cn";

interface SparklineProps {
  /** Series of numbers (up to ~60 points · oldest first) */
  data: number[];
  /** Visual tone · maps to stroke color */
  tone?: "indigo" | "emerald" | "rose" | "amber" | "zinc";
  /** Render a baseline at 0 (default true) */
  baseline?: boolean;
  /** Width in CSS pixels (viewport scales) */
  width?: number;
  /** Height in CSS pixels */
  height?: number;
  className?: string;
  /** Accessible label */
  ariaLabel?: string;
}

const TONE_STROKE: Record<NonNullable<SparklineProps["tone"]>, string> = {
  indigo: "stroke-indigo-500",
  emerald: "stroke-emerald-500",
  rose: "stroke-rose-500",
  amber: "stroke-amber-500",
  zinc: "stroke-zinc-400",
};

const TONE_FILL: Record<NonNullable<SparklineProps["tone"]>, string> = {
  indigo: "fill-indigo-500/15",
  emerald: "fill-emerald-500/15",
  rose: "fill-rose-500/15",
  amber: "fill-amber-500/15",
  zinc: "fill-zinc-400/15",
};

export function Sparkline({
  data,
  tone = "indigo",
  baseline = true,
  width = 80,
  height = 24,
  className,
  ariaLabel,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <span
        className={cn(
          "inline-block bg-zinc-100 rounded-sm",
          className,
        )}
        style={{ width, height }}
        aria-label="ไม่มีข้อมูล"
      />
    );
  }

  const w = width;
  const h = height;
  const pad = 1;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 1);
  const range = max - min || 1;
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`))
    .join(" ");

  // Area fill closes back to baseline (h-pad)
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(2)},${(h - pad).toFixed(2)} L${pad},${(h - pad).toFixed(2)} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className={cn("inline-block", className)}
      role="img"
      aria-label={ariaLabel ?? `แนวโน้ม ${data.length} จุด`}
    >
      {baseline && (
        <line
          x1={pad}
          y1={h - pad}
          x2={w - pad}
          y2={h - pad}
          className="stroke-zinc-200"
          strokeWidth={0.5}
        />
      )}
      <path d={areaD} className={TONE_FILL[tone]} />
      <path
        d={pathD}
        className={cn("fill-none", TONE_STROKE[tone])}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
