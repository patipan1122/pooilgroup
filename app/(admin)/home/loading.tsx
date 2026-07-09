import { Skeleton } from "@/components/ui/skeleton";

// /home landing skeleton — mirrors the dashboard structure (hero greeting +
// stat chips + "โปรแกรมที่ใช้บ่อย" tile grid + system stats) so entering the
// hub feels instant instead of a blank flash. Takes precedence over the
// group-root (admin)/loading.tsx for this hottest route (every admin lands here
// right after login).
export default function HomeLoading() {
  return (
    <div className="relative p-4 sm:p-8 lg:p-10 max-w-6xl mx-auto">
      {/* HERO — greeting + inline stat chips */}
      <header className="mb-8">
        <Skeleton className="h-3 w-40 mb-3" />
        <Skeleton className="h-8 w-56 mb-4" />
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </header>

      {/* QUICK LAUNCH — favorites grid */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-2.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </section>

      {/* SYSTEM — health snapshot tiles */}
      <section className="mb-10">
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </section>
    </div>
  );
}
