"use client";

// DocumentFilterSelect — compact dropdown filter for /docuflow/documents
// ────────────────────────────────────────────────────────────────────
// Same URL-driven contract as DocumentFilters (reads/writes searchParams
// via router.replace so the page re-renders with fresh data, stays in the
// URL for back/forward + share links) but as a single native <select>
// instead of a wrapping row of pill buttons — CEO feedback 2026-09-24:
// the old chip rows took too much vertical space and read as cluttered
// ("leanux หน่อย ทำเป็น dropdown แทนสิครับ").
// ────────────────────────────────────────────────────────────────────

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils/cn";

interface Option {
  value: string;
  label: string;
}

interface Props {
  /** searchParams key (e.g. "level", "status", "companyId") */
  paramKey: string;
  /** Currently-selected value (empty string = "all") */
  current: string;
  /** Option definitions, in display order (excluding the "all" option) */
  options: Option[];
  /** Existing searchParams to preserve (e.g. search term) */
  preserve?: Record<string, string>;
  /** Label shown above the dropdown */
  label: string;
  /** Optional ALL-option label override */
  allLabel?: string;
}

export function DocumentFilterSelect({
  paramKey,
  current,
  options,
  preserve = {},
  label,
  allLabel = "ทั้งหมด",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function setValue(value: string) {
    const sp = new URLSearchParams(preserve);
    if (value) sp.set(paramKey, value);
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <label className={cn("flex flex-col gap-1", pending && "opacity-70")}>
      <span className="text-[11px] font-bold text-zinc-500 tracking-wide">
        {label}
      </span>
      <select
        value={current || ""}
        onChange={(e) => setValue(e.target.value)}
        className="h-9 rounded-lg border-2 border-zinc-200 bg-white px-2.5 text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
