// Lightweight chart primitives — pure SVG, no external deps.
// Designed to look at home next to auditmekub-style numbered sections.

"use client";

import { cn } from "@/lib/utils/cn";

// =============================================================
// Sparkline — tiny line chart for branch row trends
// =============================================================
export function Sparkline({
  data,
  width = 80,
  height = 24,
  className,
}: {
  data: Array<{ date: string; value: number }>;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#d4d4d8"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - ((d.value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const last = data[data.length - 1]!.value;
  const first = data[0]!.value;
  const trend = last >= first ? "#16a34a" : "#dc2626";
  return (
    <svg width={width} height={height} className={className}>
      <polyline
        points={points}
        fill="none"
        stroke={trend}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// =============================================================
// BarStrip — payment-mix style horizontal stacked bar
// =============================================================
export function BarStrip({
  segments,
  height = 12,
  className,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  height?: number;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div
      className={cn("rounded-full overflow-hidden bg-zinc-100 flex", className)}
      style={{ height }}
    >
      {segments.map((s) => {
        const pct = (s.value / total) * 100;
        if (pct < 0.5) return null;
        return (
          <div
            key={s.label}
            style={{ width: `${pct}%`, background: s.color }}
            title={`${s.label} ${pct.toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}

// =============================================================
// ProgressBar — rounded bar with overlay markers
// =============================================================
export function ProgressBar({
  value,
  marker,
  className,
  fillColor = "var(--color-brand-600)",
}: {
  /** 0-100 actual progress */
  value: number;
  /** 0-100 expected progress (pace marker) */
  marker?: number;
  className?: string;
  fillColor?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const m =
    marker !== undefined ? Math.max(0, Math.min(100, marker)) : undefined;
  return (
    <div
      className={cn(
        "relative h-3 rounded-full bg-zinc-100 overflow-hidden",
        className,
      )}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${v}%`, background: fillColor }}
      />
      {m !== undefined && (
        <div
          className="absolute inset-y-0 w-0.5 bg-zinc-700/70"
          style={{ left: `${m}%` }}
          title={`เป้าตามสัดส่วน ${m.toFixed(0)}%`}
        />
      )}
    </div>
  );
}

// =============================================================
// CalendarHeatmap — fill-rate heatmap for current month
// =============================================================
export function CalendarHeatmap({
  cells,
  monthYear,
}: {
  cells: Array<{
    date: string;
    fillRate: number;
    total: number;
    submitted: number;
    expected: number;
  }>;
  monthYear: string;
}) {
  // Index by day of month; pad blank cells before the 1st
  if (cells.length === 0) {
    return (
      <div className="text-sm text-zinc-500 italic">
        ยังไม่มีข้อมูลเดือนนี้
      </div>
    );
  }
  const first = cells[0]!.date;
  const firstDow = new Date(first + "T00:00:00").getDay(); // 0=Sun
  const padBefore = firstDow === 0 ? 6 : firstDow - 1; // start week on Mon
  const padded = [
    ...Array.from({ length: padBefore }, () => null),
    ...cells,
  ];
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-2 flex items-center justify-between">
        <span>{monthYear}</span>
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="size-2.5 rounded-sm bg-red-200" />
          <span>0%</span>
          <span className="size-2.5 rounded-sm bg-amber-200" />
          <span>50%</span>
          <span className="size-2.5 rounded-sm bg-green-300" />
          <span>100%</span>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-[10px] text-zinc-400 mb-1.5">
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {padded.map((c, i) => {
          if (!c) return <div key={`b-${i}`} className="aspect-square" />;
          const day = parseInt(c.date.slice(8, 10), 10);
          const color = heatColor(c.fillRate);
          const isToday =
            new Date().toISOString().slice(0, 10) === c.date;
          return (
            <div
              key={c.date}
              title={`${c.date} · ${c.submitted}/${c.expected} สาขา (${c.fillRate.toFixed(0)}%)`}
              className={cn(
                "aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold tabular-num text-zinc-700",
                isToday && "ring-2 ring-[--color-brand-500]",
              )}
              style={{ background: color }}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function heatColor(pct: number): string {
  if (pct === 0) return "#fee2e2"; // red-100
  if (pct < 33) return "#fecaca"; // red-200
  if (pct < 66) return "#fde68a"; // amber-200
  if (pct < 90) return "#bef264"; // lime-300
  return "#86efac"; // green-300
}

// =============================================================
// PatternHeatmap — day-of-week × business-type
// =============================================================
const TYPE_LABEL: Record<string, string> = {
  fuel_station: "⛽ ปั๊ม",
  lpg_station: "🔵 ก๊าซ",
  bottling_plant: "🏭 บรรจุ",
  hotel: "🏨 Hotel",
  convenience_store: "🏪 7-11",
  ev_station: "⚡ EV",
  cafe: "☕ Café",
};

export function PatternHeatmap({
  data,
}: {
  data: Record<string, number[]>; // type → [Mon..Sun]
}) {
  const types = Object.keys(data).filter((t) => data[t]!.some((v) => v > 0));
  if (types.length === 0) {
    return (
      <div className="text-sm text-zinc-500 italic">ยังไม่มีข้อมูลพอ</div>
    );
  }
  // Per-row max for relative intensity
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] gap-1.5 text-[10px] text-zinc-400">
        <div />
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
      </div>
      {types.map((t) => {
        const row = data[t]!;
        const max = Math.max(...row, 1);
        return (
          <div
            key={t}
            className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] gap-1.5 items-center"
          >
            <div className="text-xs font-medium text-zinc-700 truncate">
              {TYPE_LABEL[t] ?? t}
            </div>
            {row.map((v, i) => {
              const intensity = max > 0 ? v / max : 0;
              const bg =
                intensity === 0
                  ? "#f4f4f5"
                  : `oklch(0.92 ${(0.05 + intensity * 0.18).toFixed(2)} 264)`;
              return (
                <div
                  key={i}
                  title={`${TYPE_LABEL[t] ?? t} · เฉลี่ย ฿${Math.round(v).toLocaleString("th-TH")}`}
                  className="h-7 rounded-md flex items-center justify-center text-[10px] tabular-num font-semibold text-zinc-700"
                  style={{ background: bg }}
                >
                  {v > 0 ? compact(v) : "—"}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${Math.round(n)}`;
}

// =============================================================
// HealthBadge — A-F grade pill
// =============================================================
const GRADE_COLOR: Record<string, { bg: string; fg: string; ring: string }> = {
  A: { bg: "#dcfce7", fg: "#166534", ring: "#16a34a" },
  B: { bg: "#d1fae5", fg: "#065f46", ring: "#059669" },
  C: { bg: "#dbeafe", fg: "#1e40af", ring: "#2563eb" },
  D: { bg: "#fef3c7", fg: "#92400e", ring: "#d97706" },
  E: { bg: "#fed7aa", fg: "#9a3412", ring: "#ea580c" },
  F: { bg: "#fee2e2", fg: "#991b1b", ring: "#dc2626" },
};

export function HealthBadge({
  grade,
  score,
  size = "md",
  withScore = false,
  className,
}: {
  grade: string;
  score?: number;
  size?: "sm" | "md" | "lg";
  withScore?: boolean;
  className?: string;
}) {
  const c = GRADE_COLOR[grade] ?? GRADE_COLOR.C!;
  const sizes = {
    sm: "size-6 text-[11px]",
    md: "size-8 text-sm",
    lg: "size-10 text-base",
  };
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 font-bold tabular-num",
        className,
      )}
    >
      <span
        className={cn(
          "rounded-lg flex items-center justify-center font-display",
          sizes[size],
        )}
        style={{
          background: c.bg,
          color: c.fg,
          boxShadow: `inset 0 0 0 1.5px ${c.ring}`,
        }}
      >
        {grade}
      </span>
      {withScore && score !== undefined && (
        <span className="text-xs text-zinc-500">{score}</span>
      )}
    </div>
  );
}

// =============================================================
// Donut — quick payment-mix donut (no library)
// =============================================================
export function Donut({
  segments,
  size = 100,
  thickness = 14,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="#f4f4f5"
        strokeWidth={thickness}
        fill="none"
      />
      {segments.map((s) => {
        const pct = s.value / total;
        const len = c * pct;
        const node = (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={s.color}
            strokeWidth={thickness}
            fill="none"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
        );
        offset += len;
        return node;
      })}
    </svg>
  );
}
