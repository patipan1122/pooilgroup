// Suspense fallback for the Ledger Dashboard — mirrors page.tsx (4 KPI tiles +
// AI insights panel + budget-vs-actual + by-category/by-branch bars + monthly
// trend) so the heavy multi-query dashboard holds its shape while loading.
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeaderSkeleton } from "@/components/ledger/_kit/LedgerHeaderSkeleton";

function BarsCard() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <Skeleton className="mb-3 h-4 w-32" />
      <ul className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i}>
            <div className="mb-1 flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-2.5 w-full rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LedgerDashboardLoading() {
  return (
    <div className="animate-fade-in p-4 sm:p-6">
      <LedgerHeaderSkeleton />

      {/* KPI strip — matches the 6-tile grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-24" />
          </div>
        ))}
      </div>

      {/* AI insights panel */}
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </div>

      {/* Budget vs actual */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
        <Skeleton className="mb-3 h-4 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-2.5 w-full rounded-full" />
          ))}
        </div>
      </div>

      {/* By category + by branch */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarsCard />
        <BarsCard />
      </div>

      {/* Monthly trend */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
        <Skeleton className="mb-4 h-4 w-44" />
        <div className="flex items-end justify-between gap-2" style={{ height: 160 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton
              key={i}
              className="w-full max-w-[40px] rounded-t-md"
              style={{ height: 40 + ((i * 23) % 110) }}
            />
          ))}
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        กำลังโหลด Dashboard ระบบบัญชี
      </span>
    </div>
  );
}
