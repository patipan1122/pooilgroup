// Two-tone Thai title: navy first + brand-blue accent.
// e.g. <TwoToneTitle first="ภาพรวม" accent="ยอดสาขา" />

interface Props {
  first: string;
  accent: string;
  size?: number;
  className?: string;
}

export function TwoToneTitle({ first, accent, size = 42, className }: Props) {
  return (
    <h1
      className={`ch-title-v2 font-display ${className ?? ""}`}
      style={{ fontSize: size }}
    >
      {first} <span className="accent">{accent}</span>
    </h1>
  );
}
