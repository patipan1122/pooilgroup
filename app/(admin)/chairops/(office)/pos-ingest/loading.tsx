// W3 (claude-design) · POS Ingest loading skeleton.
export default function Loading() {
  return (
    <div className="chairops-scope mx-auto max-w-screen-2xl animate-pulse p-4 sm:p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-md bg-muted" />
          <div className="h-4 w-72 rounded-md bg-muted/70" />
        </div>
        <div className="h-11 w-44 rounded-md bg-muted" />
      </div>
      <div className="mb-6 h-20 rounded-lg bg-muted/60" />
      <div className="rounded-lg border border-border bg-background">
        <div className="border-b border-border bg-muted/40 px-3 py-2">
          <div className="h-4 w-full max-w-md rounded bg-muted" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-3 border-b border-border px-3 py-3 last:border-0"
          >
            <div className="h-4 w-24 rounded bg-muted/60" />
            <div className="h-4 flex-1 rounded bg-muted/60" />
            <div className="h-4 w-32 rounded bg-muted/60" />
            <div className="h-4 w-12 rounded bg-muted/60" />
            <div className="h-4 w-40 rounded bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
