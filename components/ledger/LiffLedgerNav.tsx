// LedgerLine — mobile bottom nav for the LINE LIFF surface.
//
// Shown ONLY on /liff/ledger/my (the browse/list surface). The capture flow
// (/liff/ledger) is a focused single task with its own phase-driven action bar
// (a fixed bottom ยกเลิก/ถ่ายใหม่/บันทึก bar during review) — putting a nav there
// would cover the submit button, the exact collision the mobile audit warned
// about. The edit page, admin console and join page have their own bars too.
// So this bar lives on /my and gives the staffer a 1-tap hop to the camera.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Receipt, Camera } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function LiffLedgerNav() {
  const pathname = usePathname() ?? "";

  // Only on the list surface — see header comment for why.
  if (!pathname.startsWith("/liff/ledger/my")) return null;

  return (
    <nav
      aria-label="เมนู LedgerLine"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-2">
        <Link
          href="/liff/ledger/my"
          aria-current="page"
          className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-[var(--color-brand-600)]"
        >
          <Receipt className="size-6 text-[var(--color-brand-600)]" aria-hidden />
          ใบของฉัน
        </Link>
        <Link
          href="/liff/ledger"
          className={cn(
            "flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-zinc-500",
          )}
        >
          <Camera className="size-6 text-zinc-500" aria-hidden />
          ถ่ายใบเสร็จ
        </Link>
      </div>
    </nav>
  );
}
