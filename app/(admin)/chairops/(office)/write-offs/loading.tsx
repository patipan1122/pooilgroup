// Loading skeleton for /chairops/write-offs (3-pane master-detail).
// Matches the alerts skeleton so the visual transition is consistent.
export default function WriteOffsLoading() {
  return (
    <div className="chairops-scope min-h-screen bg-muted/40">
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
          <div className="h-4 w-48 animate-pulse rounded bg-zinc-200" />
        </div>
      </header>

      <div className="grid min-h-[calc(100dvh-3.5rem)] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)_360px]">
        {/* Sidebar */}
        <aside className="hidden border-r border-border bg-zinc-50 p-4 md:block">
          <div className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-zinc-200" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={`st-${i}`}
                className="h-9 animate-pulse rounded-lg bg-white"
              />
            ))}
            <div className="mt-5 h-3 w-24 animate-pulse rounded bg-zinc-200" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={`buc-${i}`}
                  className="h-7 w-24 animate-pulse rounded-full bg-zinc-200"
                />
              ))}
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 bg-background p-4 sm:p-6">
          <div className="mb-4 h-8 w-52 animate-pulse rounded bg-zinc-200" />
          <div className="mb-4 h-4 w-96 animate-pulse rounded bg-zinc-200" />
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="h-10 border-b border-zinc-200 bg-zinc-50" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`row-${i}`}
                className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3"
              >
                <div className="h-4 w-4 animate-pulse rounded bg-zinc-200" />
                <div className="h-4 w-20 animate-pulse rounded bg-zinc-200" />
                <div className="h-4 w-28 animate-pulse rounded bg-zinc-200" />
                <div className="h-4 w-16 animate-pulse rounded bg-zinc-200" />
                <div className="h-4 w-36 animate-pulse rounded bg-zinc-200" />
                <div className="ml-auto h-6 w-16 animate-pulse rounded bg-zinc-200" />
              </div>
            ))}
          </div>
        </main>

        {/* Meta */}
        <aside className="hidden border-t border-border bg-zinc-50/60 p-4 lg:block lg:border-l lg:border-t-0">
          <div className="space-y-3">
            <div className="h-6 w-32 animate-pulse rounded bg-zinc-200" />
            <div className="h-5 w-3/4 animate-pulse rounded bg-zinc-200" />
            <div className="h-24 animate-pulse rounded-xl bg-white" />
            <div className="h-20 animate-pulse rounded-xl bg-white" />
            <div className="h-16 animate-pulse rounded-xl bg-white" />
            <div className="h-11 animate-pulse rounded-lg bg-white" />
          </div>
        </aside>
      </div>
    </div>
  );
}
