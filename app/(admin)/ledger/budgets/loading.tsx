// Suspense fallback for งบประมาณ — mirrors page.tsx (budget list on the left
// with progress bars + the set/edit form panel on the right ~340px) so the page
// keeps its shape while the org+company-scoped budgets + categories resolve.
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeaderSkeleton } from "@/components/ledger/_kit/LedgerHeaderSkeleton";

export default function LedgerBudgetsLoading() {
  return (
    <div className="p-4 sm:p-6">
      <LedgerHeaderSkeleton />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        {/* Budget list */}
        <div className="rounded-2xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 p-4">
            <Skeleton className="h-4 w-36" />
          </div>
          <ul className="divide-y divide-zinc-100">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="space-y-1.5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="size-6 rounded-md" />
                </div>
                <Skeleton className="h-2.5 w-full rounded-full" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Set / edit budget form */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton className="mb-1.5 h-3 w-20" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ))}
            <Skeleton className="mt-2 h-10 w-full rounded-xl" />
          </div>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        กำลังโหลดงบประมาณ
      </span>
    </div>
  );
}
