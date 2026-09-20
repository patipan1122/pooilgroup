// Roster-table skeleton for /chairops/maids (Suspense fallback).
// 2026-09-20 upspeed: this route had no loading.tsx — nav fell through to
// the (office) group-root skeleton (KPI tiles + leaderboard shape), a
// mismatch against this page's actual filter-pills + table layout. Also
// covers /chairops/maids/[userId], /[userId]/pay, /[userId]/contract (no
// own loading.tsx either) via route-group inheritance, same pattern as
// (office)/users/loading.tsx.

import { Skeleton } from "@/components/ui/skeleton";

export default function MaidsLoading() {
  return (
    <div className="chairops-scope p-4 sm:p-6">
      <Skeleton className="mb-2 h-3 w-28" />
      <Skeleton className="mb-1 h-7 w-56" />
      <Skeleton className="mb-5 h-4 w-80" />

      {/* filter pills row */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>

      {/* roster table rows */}
      <div className="space-y-1.5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
