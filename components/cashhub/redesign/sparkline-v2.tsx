// SparklineV2 — smooth quadratic with optional area fill.
// Matches design's shared.jsx `Sparkline` 1:1.

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  smooth?: boolean;
  className?: string;
}

export function SparklineV2({
  data,
  width = 80,
  height = 24,
  color = "var(--ch-brand)",
  fill = false,
  smooth = true,
  className,
}: Props) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);
  const pts: [number, number][] = data.map((v, i) => [
    i * stepX,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);

  let d: string;
  if (smooth) {
    d = pts.reduce((acc, p, i) => {
      if (i === 0) return `M ${p[0]} ${p[1]}`;
      const prev = pts[i - 1];
      const cx = (prev[0] + p[0]) / 2;
      return acc + ` Q ${cx} ${prev[1]} ${cx} ${(prev[1] + p[1]) / 2} T ${p[0]} ${p[1]}`;
    }, "");
  } else {
    d = "M " + pts.map((p) => p.join(" ")).join(" L ");
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`block ${className ?? ""}`}
      aria-hidden
    >
      {fill && (
        <path
          d={`${d} L ${width} ${height} L 0 ${height} Z`}
          fill={color}
          opacity="0.12"
        />
      )}
      <path className="ch-spark" d={d} stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
