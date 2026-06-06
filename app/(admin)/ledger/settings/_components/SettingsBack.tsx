// SettingsBack — "← ตั้งค่า" link shown atop every settings sub-page so the
// drill-in always has a one-tap way back (preserves the company scope).
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function SettingsBack({ companyId }: { companyId: string | null }) {
  const qs = companyId ? `?company=${encodeURIComponent(companyId)}` : "";
  return (
    <Link
      href={`/ledger/settings${qs}`}
      className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition hover:text-zinc-800"
    >
      <ChevronLeft className="size-4" aria-hidden />
      ตั้งค่า
    </Link>
  );
}
