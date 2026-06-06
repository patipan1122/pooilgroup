// SettingsBack — breadcrumb shown atop every settings sub-page:
// "← รายการ  /  ตั้งค่า" so users can jump back two levels with one tap.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function SettingsBack({ companyId }: { companyId: string | null }) {
  const qs = companyId ? `?company=${encodeURIComponent(companyId)}` : "";
  return (
    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-zinc-500">
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
  );
}
