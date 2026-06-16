// Sub-nav row shared by the Bank-Recon Controls workspace pages
// (คลัง · คำขออนุมัติ · โยกเงิน · รายการพิเศษ). Plain server component
// (no state) → safe to render inside server pages. Highlights the active tab.

import Link from "next/link";
import { Archive, ClipboardCheck, ArrowLeftRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Key = "archive" | "approvals" | "transfers" | "special-items";

const TABS: { key: Key; label: string; href: string; Icon: typeof Archive }[] = [
  { key: "archive", label: "คลัง", href: "archive", Icon: Archive },
  { key: "approvals", label: "คำขออนุมัติ", href: "approvals", Icon: ClipboardCheck },
  { key: "transfers", label: "โยกเงิน", href: "transfers", Icon: ArrowLeftRight },
  { key: "special-items", label: "รายการพิเศษ", href: "special-items", Icon: Sparkles },
];

export function BankReconControlsNav({
  companyId,
  active,
  account,
}: {
  companyId: string;
  active?: Key;
  account?: string; // เมื่อระบุ = ผูกขอบเขตไว้ที่บัญชีเดียว (เข้าจากในบัญชี → เห็นเฉพาะของบัญชีนั้น)
}) {
  const cp = account ? `company=${companyId}&account=${account}` : `company=${companyId}`;
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {TABS.map(({ key, label, href, Icon }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={`/ledger/bank-recon/${href}?${cp}`}
            className={cn(
              "press inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-300 sm:min-h-0 sm:py-2",
              on
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
            )}
            aria-current={on ? "page" : undefined}
          >
            <Icon size={15} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
