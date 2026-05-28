export default function RecruitLoading() {
  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-60px)]">
      {/* Filters skeleton */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-zinc-200 bg-white p-4 gap-3">
        <div className="h-3 w-20 bg-zinc-100 rounded animate-pulse" />
        <div className="h-7 w-16 bg-zinc-200 rounded animate-pulse" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-8 bg-zinc-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </aside>

      {/* List skeleton */}
      <section className="flex flex-col w-full lg:w-[380px] shrink-0 border-r border-zinc-200 bg-white">
        <div className="p-3 border-b border-zinc-100">
          <div className="h-10 bg-zinc-100 rounded-xl animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-zinc-100 space-y-2"
            >
              <div className="flex justify-between gap-2">
                <div className="h-4 w-32 bg-zinc-200 rounded animate-pulse" />
                <div className="h-4 w-10 bg-zinc-100 rounded animate-pulse" />
              </div>
              <div className="h-3 w-40 bg-zinc-100 rounded animate-pulse" />
              <div className="h-5 w-16 bg-zinc-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </section>

      {/* Detail skeleton (desktop only) */}
      <main className="hidden lg:flex flex-1 items-center justify-center bg-zinc-50/50">
        <div className="text-sm text-zinc-400">กำลังโหลด...</div>
      </main>
    </div>
  );
}
