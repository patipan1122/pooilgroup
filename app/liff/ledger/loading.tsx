// Suspense fallback for the LedgerLine LIFF capture screen — covers the gap
// while the server shell resolves the signed-in user's companies/branches/
// categories. Mirrors the capture layout (logo + mascot hero + context picker +
// the big "แตะเพื่อถ่าย" dropzone) so the in-LINE screen doesn't flash white.
import { LedgerMascot } from "@/components/ledger/Brand";

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-gradient-to-br from-zinc-100 to-zinc-200 ${className ?? ""}`}
    />
  );
}

export default function LedgerLiffLoading() {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="min-h-screen bg-zinc-50 px-4 pb-32 pt-5">
        {/* header — logo + mascot hero */}
        <header className="mb-4">
          <Bar className="mb-3 h-5 w-24" />
          <div className="flex items-center gap-3">
            <LedgerMascot size={56} priority className="shrink-0 opacity-60" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className="h-6 w-32" />
              <Bar className="h-4 w-48" />
            </div>
          </div>
        </header>

        {/* company / branch picker */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
          <div className="space-y-1">
            <Bar className="h-3 w-12" />
            <Bar className="h-10 w-full rounded-xl" />
          </div>
          <div className="space-y-1">
            <Bar className="h-3 w-16" />
            <Bar className="h-10 w-full rounded-xl" />
          </div>
        </div>

        {/* capture dropzone */}
        <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-brand-200)] bg-[var(--color-brand-50)]">
          <div className="size-9 animate-spin rounded-full border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
          <p className="text-sm font-medium text-[var(--color-brand-700)]">
            กำลังโหลด...
          </p>
        </div>

        <span className="sr-only" aria-live="polite">
          กำลังเตรียมหน้าถ่ายใบเสร็จ
        </span>
      </div>
    </div>
  );
}
