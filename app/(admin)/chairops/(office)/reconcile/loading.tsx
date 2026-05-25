// 3-pane skeleton for reconcile list/detail (Suspense fallback).
// Mirrors MasterDetailShell grid so the layout doesn't shift on resolve.

import { Skeleton } from "@/components/ui/skeleton";

export default function ReconcileLoading() {
  return (
    <div className="chairops-scope">
      <div className="grid min-h-[calc(100dvh-3.5rem)] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)_360px]">
        {/* sidebar skeleton */}
        <aside className="hidden border-r border-zinc-200 bg-zinc-50 p-3 md:block">
          <Skeleton className="mb-3 h-3 w-16" />
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="space-y-2">
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </aside>

        {/* main skeleton */}
        <main className="min-w-0 p-4 sm:p-6">
          <Skeleton className="mb-2 h-3 w-24" />
          <Skeleton className="mb-2 h-7 w-64" />
          <Skeleton className="mb-5 h-4 w-96" />

          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>

          <Skeleton className="mb-3 h-5 w-48" />
          <Skeleton className="h-96 w-full" />
        </main>

        {/* meta skeleton */}
        <aside className="hidden border-l border-zinc-200 bg-zinc-50/60 p-4 lg:block">
          <Skeleton className="mb-3 h-5 w-32" />
          <Skeleton className="mb-3 aspect-video w-full" />
          <Skeleton className="mb-2 h-3 w-full" />
          <Skeleton className="mb-2 h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </aside>
      </div>
    </div>
  );
}
