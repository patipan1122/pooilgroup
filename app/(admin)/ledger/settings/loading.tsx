// Suspense fallback for ตั้งค่า — mirrors the SettingsHub tile-row layout
// (sticky back bar + header + 3 grouped sections of short rows inside max-w-2xl)
// so the skeleton is ~the height of the real hub and there's no layout shift
// when the org+company-scoped counts resolve.
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeaderSkeleton } from "@/components/ledger/_kit/LedgerHeaderSkeleton";

function TileRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-white p-4">
      <Skeleton className="size-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
      <Skeleton className="h-5 w-8 rounded-full" />
      <Skeleton className="size-4 rounded" />
    </div>
  );
}

export default function LedgerSettingsLoading() {
  // group sizes mirror SettingsHub: การจดบันทึก (~2-3) · ทีมงาน & สิทธิ์ (3) · การเชื่อมต่อ (~2)
  const groups = [2, 3, 2];

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      {/* sticky back bar */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-zinc-100 bg-white/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <Skeleton className="h-4 w-36" />
      </div>

      <LedgerHeaderSkeleton />

      <div className="mx-auto max-w-2xl space-y-5">
        {groups.map((rows, g) => (
          <section key={g} className="space-y-2">
            <Skeleton className="ml-1 h-3 w-24" />
            {Array.from({ length: rows }, (_, i) => (
              <TileRowSkeleton key={i} />
            ))}
          </section>
        ))}
      </div>

      <span className="sr-only" aria-live="polite">
        กำลังโหลดการตั้งค่า
      </span>
    </div>
  );
}
