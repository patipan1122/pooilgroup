// DeltaPill — ↗ +N% / ↘ −N% inline indicator.
// Falls back to subtle dot when pct is null/0.

interface Props {
  pct: number | null;
  size?: "sm" | "md";
}

export function DeltaPill({ pct, size = "md" }: Props) {
  if (pct == null || pct === 0) {
    return (
      <span className="text-[var(--ch-text-3)] text-[10.5px]">·</span>
    );
  }
  const positive = pct > 0;
  return (
    <span
      className="font-semibold whitespace-nowrap"
      style={{
        fontSize: size === "sm" ? 10.5 : 12,
        color: positive ? "#15803d" : "#b91c1c",
      }}
    >
      {positive ? "↗" : "↘"} {positive ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}
