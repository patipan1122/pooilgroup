// DEPRECATED · 2026-05-25 · W6 claude-design cutover.
// Old `/chairops/collect/*` routes now redirect to `(maid)/m/collect/*` —
// pages handle the redirect; this layout is a passthrough so the redirect
// fires immediately without a MaidShell render. Slated for delete +1 week
// per IA backward-compat plan.
export default function DeprecatedCollectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
