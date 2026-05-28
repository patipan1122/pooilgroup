// Exec home skeleton · 5 KPI tiles + leaderboard placeholder.
// Spec: §1.43 + plan §2.3 "PARTIAL Wave 1 — exec/reconcile/maid-home loadings"
//
// Renders in `.chairops-scope` so kit tokens apply. Solid bg only · no animate
// gradients that flash on slow phones.

export default function ExecHomeLoading() {
  return (
    <div className="chairops-scope flex flex-col gap-6">
      {/* header skeleton */}
      <div className="flex flex-col gap-2">
        <div className="h-3 w-32 rounded-full bg-muted" />
        <div className="h-7 w-64 rounded-md bg-muted" />
        <div className="h-3 w-48 rounded-full bg-muted" />
      </div>

      {/* KPI tiles · 2x3 mobile · 5-col md+ */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-5 md:gap-4"
        aria-hidden="true"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[120px] flex-col justify-between gap-2 rounded-2xl border border-border bg-background p-4 ring-1 ring-zinc-200"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 rounded-full bg-muted" />
              <div className="size-8 rounded-lg bg-muted" />
            </div>
            <div className="mx-auto h-8 w-24 rounded-md bg-muted" />
            <div className="mx-auto h-3 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>

      {/* leaderboard skeleton */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="mb-3 h-4 w-40 rounded-md bg-muted" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>

      {/* alerts skeleton */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="mb-3 h-4 w-32 rounded-md bg-muted" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-10 rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>

      <span className="sr-only">กำลังโหลดสรุป ChairOps...</span>
    </div>
  );
}
