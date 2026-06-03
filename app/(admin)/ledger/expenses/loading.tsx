// Suspense fallback for รายจ่าย — mirrors the two-pane workspace (filterable
// list on the left ~420px, review pane on the right) so the layout stays put
// while the org+company-scoped expense rows + selected receipt resolve.
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeaderSkeleton } from "@/components/ledger/_kit/LedgerHeaderSkeleton";

export default function LedgerExpensesLoading() {
  return (
    <div className="p-4 sm:p-6">
      <LedgerHeaderSkeleton showRight />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* LEFT — filters + list */}
        <div className="rounded-2xl border border-zinc-200 bg-white">
          {/* filter bar */}
          <div className="space-y-2 border-b border-zinc-100 p-3">
            <Skeleton className="h-9 w-full rounded-xl" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
          </div>
          {/* rows */}
          <div className="divide-y divide-zinc-100">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — review pane (image + edit form) */}
        <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
          <Skeleton className="mb-4 h-56 w-full" />
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
            <Skeleton className="mt-2 h-11 w-full rounded-xl" />
          </div>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        กำลังโหลดรายการรายจ่าย
      </span>
    </div>
  );
}
