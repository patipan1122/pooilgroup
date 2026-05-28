// Placeholder for v2 secondary nav pages (Team / Audit / Settings) that the
// redesign mockup defined as stubs. Real builds tracked as TODO[v2-wire-db].

export function V2Placeholder({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="cf-page">
      <div className="cf-eyebrow">{eyebrow}</div>
      <h1 className="cf-h1">{title}</h1>
      <div className="cf-page-sub">{sub}</div>
    </div>
  );
}
