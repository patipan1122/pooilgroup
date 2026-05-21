// SectionPill — numbered IBM Plex Mono badge used in headers.
// Matches design tokens.css `.ch-section-pill` (h7) — scoped via .ch-scope.

interface Props {
  num: string | number;
  label: string;
}

export function SectionPill({ num, label }: Props) {
  return (
    <span className="ch-pill">
      <span className="num">{num}</span>
      {label}
    </span>
  );
}
