// Maid LIFF skeleton — covers the ENTIRE (maid)/m subtree (home, collect,
// deposit, cleanliness, damage, parts). Before this, every tab open in the
// LINE Mini App showed a white screen during the server render (the home alone
// fires ~9 DB queries). Now the maid sees the page shape instantly.
//
// Solid grey blocks (no animated gradient) on purpose — gradient pulses flash
// badly on low-end Android / slow cellular, the exact phones maids use.
// Mirrors the maid-home layout: greeting card → 2-KPI block → task cards.
export default function MaidHomeLoading() {
  return (
    <div className="chairops-scope">
      <div className="space-y-4">
        {/* greeting card */}
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex items-start gap-3">
            <div className="h-16 w-14 shrink-0 rounded-xl bg-emerald-100" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-40 rounded-md bg-zinc-200" />
              <div className="h-3 w-32 rounded-full bg-zinc-200" />
            </div>
            <div className="h-6 w-14 shrink-0 rounded-full bg-zinc-200" />
          </div>
        </div>

        {/* KPI row: 2 tiles + 1 wide */}
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[88px] space-y-2 rounded-2xl border border-border bg-background p-4"
            >
              <div className="h-3 w-20 rounded-full bg-muted" />
              <div className="h-6 w-16 rounded-md bg-muted" />
            </div>
          ))}
          <div className="col-span-2 min-h-[72px] space-y-2 rounded-2xl border border-border bg-background p-4">
            <div className="h-3 w-24 rounded-full bg-muted" />
            <div className="h-6 w-28 rounded-md bg-muted" />
          </div>
        </div>

        {/* task cards */}
        <div className="space-y-2">
          <div className="h-4 w-24 rounded-md bg-muted" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-border bg-background p-4"
            >
              <div className="size-10 shrink-0 rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-28 rounded-md bg-muted" />
                <div className="h-3 w-20 rounded-full bg-muted" />
              </div>
            </div>
          ))}
        </div>

        <span className="sr-only" aria-live="polite">
          กำลังโหลด...
        </span>
      </div>
    </div>
  );
}
