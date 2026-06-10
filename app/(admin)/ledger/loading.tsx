// Suspense fallback for the Ledger home page — mirrors page.tsx layout so the
// screen holds its shape (header strip + 4 KPI tiles + 2 panels) instead of
// flashing to white while the org+company-scoped queries resolve.
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeaderSkeleton } from "@/components/ledger/_kit/LedgerHeaderSkeleton";

export default function LedgerHomeLoading() {
  return (
    <div className="animate-fade-in p-4 sm:p-6">
      <LedgerHeaderSkeleton />

      {/* Welcome banner — matches the mascot greeting strip */}
      <div className="mb-5 flex items-center gap-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
        <Skeleton className="size-[72px] shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>

      {/* KPI tiles — matches the 4-tile grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex min-h-[110px] flex-col justify-between gap-2 rounded-2xl bg-white p-4 ring-1 ring-zinc-200"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-4 rounded-md" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* งานที่ต้องทำ — actionable backlog card */}
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
        <Skeleton className="mb-2 h-4 w-32" />
        <div className="space-y-3 pt-1">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-6 w-12 shrink-0 rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Two panels — รอยืนยันล่าสุด + ค่าใช้จ่ายตามหมวด */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, p) => (
          <div
            key={p}
            className="rounded-2xl border border-zinc-200 bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only" aria-live="polite">
        กำลังโหลดภาพรวมระบบบัญชี
      </span>
    </div>
  );
}
