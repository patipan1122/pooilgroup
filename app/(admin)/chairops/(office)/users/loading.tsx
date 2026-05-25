// 2-pane skeleton for users list (Suspense fallback).
// Mirrors MasterDetailShell grid so the layout doesn't shift on resolve.

import { Skeleton } from "@/components/ui/skeleton";

export default function UsersLoading() {
  return (
    <div className="chairops-scope">
      <div className="grid min-h-[calc(100dvh-3.5rem)] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* sidebar skeleton */}
        <aside className="hidden border-r border-zinc-200 bg-zinc-50 p-3 md:block">
          <Skeleton className="mb-3 h-3 w-12" />
          <Skeleton className="mb-4 h-5 w-24" />
          <div className="space-y-1.5">
            {Array.from({ length: 14 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        </aside>

        {/* main skeleton */}
        <main className="min-w-0 p-4 sm:p-6">
          <Skeleton className="mb-2 h-3 w-28" />
          <Skeleton className="mb-2 h-7 w-56" />
          <Skeleton className="mb-5 h-4 w-80" />
          <Skeleton className="mb-4 h-9 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    </div>
  );
}
