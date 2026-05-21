// Public surface for ระบบแจ้งซ่อม — NO auth required.
// Routes: /r (landing) · /r/new (submit) · /r/track · /r/track/[code]
import Link from "next/link";
import { Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export default function RepairPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white">
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-zinc-200">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/r" className="flex items-center gap-2 font-extrabold text-zinc-900">
            <span className="size-8 rounded-lg bg-[var(--color-brand-600)] text-white grid place-items-center">
              <Wrench className="size-4" />
            </span>
            <span className="text-base tracking-tight">ระบบแจ้งซ่อม</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/r/new"
              className="px-3 h-9 inline-flex items-center rounded-lg font-bold text-zinc-700 hover:bg-zinc-100"
            >
              แจ้งใหม่
            </Link>
            <Link
              href="/r/track"
              className="px-3 h-9 inline-flex items-center rounded-lg font-bold text-zinc-700 hover:bg-zinc-100"
            >
              ติดตาม
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10">{children}</main>
      <footer className="mx-auto max-w-[1100px] px-4 sm:px-6 pb-10 pt-6 text-xs text-zinc-500 text-center">
        © Pooilgroup · ระบบแจ้งซ่อม · ใช้สำหรับแจ้งงานซ่อมภายในเท่านั้น
      </footer>
    </div>
  );
}
