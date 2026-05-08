// Skeleton primitives for Suspense fallbacks. Pulse-animated grey blocks
// keep the layout shape so the page doesn't flash to white between
// navigation and data load. Used in app/**/loading.tsx files.

import { cn } from "@/lib/utils/cn";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200",
        className,
      )}
      {...props}
    />
  );
}

/** Page-level Suspense fallback — header strip + 3 card rows. */
export function PageSkeleton({ title }: { title?: string }) {
  return (
    <div className="p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto pb-24">
      <div className="mb-10">
        <Skeleton className="h-3 w-32 mb-3" />
        <Skeleton className="h-8 sm:h-10 w-72 sm:w-96 mb-3" />
        <Skeleton className="h-4 w-64" />
        {title && (
          <p className="sr-only" aria-live="polite">
            กำลังโหลด {title}
          </p>
        )}
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  );
}

/** Tabular data skeleton — header + N rows. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y divide-zinc-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="size-8 rounded-full shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
