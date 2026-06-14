// Group-level fallback for the admin-direct ChairOps pages that don't ship
// their own loading.tsx (accounts, audit, branches, cleanliness, collect,
// damage, dashboard, parts, reports, line-setup, …). The (office) and (maid)
// route groups have their own, more specific skeletons. chairops/layout.tsx
// (.co-scope) stays mounted, so this only fills the page body.
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function ChairOpsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <TableSkeleton rows={8} />
      <span className="sr-only" aria-live="polite">
        กำลังโหลด...
      </span>
    </div>
  );
}
