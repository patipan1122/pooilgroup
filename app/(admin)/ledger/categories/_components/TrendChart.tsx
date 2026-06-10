// Dependency-free inline-SVG trend chart for the category ledger book.
//
// CEO wants "ดูย้อนหลังดูความเปลี่ยนแปลง" — a simple month/year line so the eye
// catches a spike (ค่าไฟพุ่ง) at a glance. NO charting npm package (CEO rule:
// don't add deps for this) — a plain <svg> polyline + dots + month labels,
// responsive via viewBox so it scales to any phone width.
//
// Pure presentational client component: takes already-bucketed { period,total }
// points (oldest→newest) from categoryLedger() and draws them. Empty/single
// point degrades gracefully (no NaN, no crash).
"use client";

import { useId } from "react";

export interface TrendPoint {
  /** YYYY-MM. */
  period: string;
  total: number;
}

function baht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

/** "2026-06" → "มิ.ย. 69" (Thai short month + 2-digit Buddhist year). */
const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const be = (y + 543) % 100;
  return `${TH_MONTHS[m - 1] ?? period} ${String(be).padStart(2, "0")}`;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const gradId = useId();
  // viewBox coordinate space — width scales via preserveAspectRatio; height fixed.
  const W = 320;
  const H = 120;
  const padX = 8;
  const padTop = 12;
  const padBottom = 22; // room for month labels

  if (points.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 text-sm text-zinc-500">
        ยังไม่มีข้อมูลพอจะแสดงแนวโน้ม
      </div>
    );
  }

  const max = Math.max(1, ...points.map((p) => p.total));
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  // X positions: evenly spread; a single point sits centered.
  const x = (i: number): number =>
    points.length === 1
      ? W / 2
      : padX + (innerW * i) / (points.length - 1);
  const y = (v: number): number => padTop + innerH * (1 - v / max);

  const linePts = points.map((p, i) => `${x(i)},${y(p.total)}`).join(" ");
  // Area fill polygon — close down to the baseline.
  const areaPts = `${padX},${padTop + innerH} ${linePts} ${padX + innerW},${padTop + innerH}`;

  // Only label first / middle / last month to avoid crowding on a phone.
  const labelIdx = new Set<number>([0, Math.floor((points.length - 1) / 2), points.length - 1]);

  const peakIdx = points.reduce(
    (best, p, i) => (p.total > points[best].total ? i : best),
    0,
  );

  return (
    <figure className="animate-fade-in rounded-xl border border-zinc-200 bg-white p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[120px] w-full"
        role="img"
        aria-label={`แนวโน้มค่าใช้จ่าย ${points.length} เดือน · สูงสุด ${baht(max)}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* area + line */}
        {points.length > 1 && (
          <polygon points={areaPts} fill={`url(#${gradId})`} stroke="none" />
        )}
        <polyline
          points={linePts}
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* dots — peak emphasized */}
        {points.map((p, i) => (
          <circle
            key={p.period}
            cx={x(i)}
            cy={y(p.total)}
            r={i === peakIdx ? 3.5 : 2.5}
            fill={i === peakIdx ? "var(--color-brand-600)" : "white"}
            stroke="var(--color-brand-600)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${monthLabel(p.period)} · ${baht(p.total)}`}</title>
          </circle>
        ))}

        {/* month labels (subset) */}
        {points.map((p, i) =>
          labelIdx.has(i) ? (
            <text
              key={`lbl-${p.period}`}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-zinc-500"
              style={{ fontSize: 9 }}
            >
              {monthLabel(p.period)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>สูงสุด {baht(max)}</span>
        <span>{points.length} เดือน</span>
      </figcaption>
    </figure>
  );
}

/** Tiny inline-SVG sparkline (no axes/labels) for the ledger-book index rows. */
export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const W = 80;
  const H = 24;
  if (values.length === 0 || values.every((v) => v === 0)) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
        <line
          x1={2}
          y1={H - 4}
          x2={W - 2}
          y2={H - 4}
          stroke="var(--color-zinc-200, #e4e4e7)"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  const max = Math.max(1, ...values);
  const x = (i: number): number =>
    values.length === 1 ? W / 2 : 2 + ((W - 4) * i) / (values.length - 1);
  const y = (v: number): number => 3 + (H - 6) * (1 - v / max);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="แนวโน้มย่อ"
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="var(--color-brand-500)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1])}
        r={2}
        fill="var(--color-brand-600)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
