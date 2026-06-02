// Suspense fallback for ตั้งค่า — mirrors page.tsx (full-width category manager
// on top + LINE channel card + export config card below) so the layout holds
// while the org+company-scoped categories resolve.
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeaderSkeleton } from "@/components/ledger/_kit/LedgerHeaderSkeleton";

export default function LedgerSettingsLoading() {
  return (
    <div className="p-4 sm:p-6">
      <LedgerHeaderSkeleton />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Category manager (full width) */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <div className="divide-y divide-zinc-100">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="size-5 rounded-full shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="size-6 rounded-md" />
              </div>
            ))}
          </div>
        </div>

        {/* LINE channel card + export config card */}
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200 bg-white p-4"
          >
            <Skeleton className="mb-3 h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-4 h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>

      <span className="sr-only" aria-live="polite">
        กำลังโหลดการตั้งค่า
      </span>
    </div>
  );
}
