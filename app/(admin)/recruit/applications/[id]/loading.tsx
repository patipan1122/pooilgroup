export default function ApplicationDetailLoading() {
  return (
    <div className="bg-white min-h-screen">
      <div className="border-b border-zinc-200 px-5 sm:px-8 py-4">
        <div className="h-4 w-24 bg-zinc-100 rounded animate-pulse" />
      </div>
      <div className="p-5 sm:p-7 max-w-3xl space-y-5">
        <div className="space-y-3">
          <div className="h-3 w-40 bg-zinc-100 rounded animate-pulse" />
          <div className="h-9 w-64 bg-zinc-200 rounded animate-pulse" />
          <div className="h-4 w-48 bg-zinc-100 rounded animate-pulse" />
        </div>
        <div className="h-32 bg-zinc-100 rounded-2xl animate-pulse" />
        <div className="h-40 bg-zinc-100 rounded-2xl animate-pulse" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-zinc-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
