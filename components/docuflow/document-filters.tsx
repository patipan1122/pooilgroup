"use client";

// DocumentFilters — interactive filter chip bar for /docuflow/documents
// ────────────────────────────────────────────────────────────────────
// Reads/writes searchParams via router.replace so the page (server)
// re-renders with fresh data. Stays in the URL so back/forward + share
// links work naturally.
// ────────────────────────────────────────────────────────────────────

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils/cn";

interface Chip {
  /** URL query value */
  value: string;
  label: string;
  count?: number;
}

interface Props {
  /** searchParams key (e.g. "level", "status") */
  paramKey: string;
  /** Currently-selected value (empty string = "all") */
  current: string;
  /** Chip definitions, in display order */
  chips: Chip[];
  /** Existing searchParams to preserve (e.g. search term) */
  preserve?: Record<string, string>;
  /** Optional ALL chip label override */
  allLabel?: string;
}

export function DocumentFilters({
  paramKey,
  current,
  chips,
  preserve = {},
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

  const allChip: Chip = { value: "", label: allLabel };
  const allChips: Chip[] = [allChip, ...chips];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        pending && "opacity-70",
      )}
    >
      {allChips.map((c) => {
        const active = (current || "") === c.value;
        return (
          <button
            key={c.value || "__all__"}
            type="button"
            onClick={() => setValue(c.value)}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium border transition-colors",
              active
                ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)] shadow-soft"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300",
            )}
          >
            {c.label}
            {c.count !== undefined && (
              <span
                className={cn(
                  "tabular-nums text-xs rounded-md px-1.5 py-0.5",
                  active ? "bg-white/20" : "bg-zinc-100 text-zinc-600",
                )}
              >
                {c.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
