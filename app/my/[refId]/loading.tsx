export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-md mx-auto pb-12">
        <div className="px-6 pt-10 pb-12 bg-gradient-to-br from-[var(--color-brand-600)] to-[var(--color-brand-900)] text-white animate-pulse">
          <div className="h-3 w-20 bg-white/20 rounded" />
          <div className="h-7 w-40 bg-white/30 rounded mt-3" />
          <div className="h-3 w-32 bg-white/20 rounded mt-5" />
          <div className="h-5 w-24 bg-white/15 rounded mt-4" />
        </div>
        <div className="mx-4 -mt-6 rounded-2xl bg-white shadow-lg p-5 animate-pulse">
          <div className="h-3 w-24 bg-zinc-200 rounded mb-3" />
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="size-7 rounded-full bg-zinc-200" />
            ))}
          </div>
        </div>
        <div className="px-4 mt-4 animate-pulse">
          <div className="rounded-2xl p-4 bg-zinc-100 border border-zinc-200 h-20" />
        </div>
      </div>
    </div>
  );
}
