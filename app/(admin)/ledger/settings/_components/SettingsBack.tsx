// SettingsBack — sticky breadcrumb shown atop every settings sub-page.
// Sticks at the top when the user scrolls down so they can always see
// "← รายการ / ตั้งค่า" and navigate back without scrolling back up.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function SettingsBack({ companyId }: { companyId: string | null }) {
  const qs = companyId ? `?company=${encodeURIComponent(companyId)}` : "";
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-zinc-100 bg-white/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-1 text-sm font-medium text-zinc-500">
        <Link
          href={`/ledger/expenses${qs}`}
          className="inline-flex items-center gap-0.5 transition hover:text-zinc-800"
        >
          <ChevronLeft className="size-4" aria-hidden />
          รายการ
        </Link>
        <span className="text-zinc-300">/</span>
        <Link
          href={`/ledger/settings${qs}`}
          className="transition hover:text-zinc-800"
        >
          ตั้งค่า
        </Link>
      </div>
    </div>
  );
}
