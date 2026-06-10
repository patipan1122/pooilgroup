// Skeleton mirror of <LedgerHeader> (logo line + title + subtitle + the
// บริษัท/สาขา picker on the right). Every /ledger admin page opens with this
// header, so the loading.tsx files reuse one shape — keeps the page from
// jumping when real data swaps in.
import { Skeleton } from "@/components/ui/skeleton";

export function LedgerHeaderSkeleton({
  showRight = false,
}: {
  /** Reserve space for a right-side action button (e.g. รายจ่าย's upload/export). */
  showRight?: boolean;
}) {
  return (
    <div className="animate-fade-in mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {/* logo strip */}
        <Skeleton className="mb-1.5 h-[22px] w-24" />
        {/* title */}
        <Skeleton className="h-7 w-44 sm:w-56" />
        {/* subtitle */}
        <Skeleton className="mt-1.5 h-4 w-32" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* company/branch picker */}
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
        {showRight && <Skeleton className="h-9 w-24 rounded-lg" />}
      </div>
    </div>
  );
}
