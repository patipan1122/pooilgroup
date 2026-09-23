"use client";

// DocumentViewTabs — segmented control switching /docuflow/documents between
// "category" / "tree" / "list" views via the `view` query param.
// ────────────────────────────────────────────────────────────────────
// Mirrors the router.replace + useTransition URL-param pattern from
// DocumentFilters (components/docuflow/document-filters.tsx) so every
// control on this page behaves consistently. Uses the `.df-seg`/`.df-on`
// classes from docuflow.css (same visual style as the old static tabs on
// /docuflow/browse) but with real onClick wiring.
// ────────────────────────────────────────────────────────────────────

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils/cn";

export interface ViewTabOption {
  /** URL `view` query value. Empty string = default view (param omitted). */
  value: string;
  label: string;
}

interface Props {
  /** Currently-active `view` value ("" = default). */
  current: string;
  options: ViewTabOption[];
  /** Existing searchParams to preserve (filters etc.) when switching views. */
  preserve?: Record<string, string>;
}

export function DocumentViewTabs({ current, options, preserve = {} }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function setView(value: string) {
    const sp = new URLSearchParams(preserve);
    if (value) sp.set("view", value);
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div
      className={cn("df-seg", pending && "opacity-70")}
      role="group"
      aria-label="มุมมอง"
    >
      {options.map((o) => (
        <button
          key={o.value || "__default__"}
          type="button"
          onClick={() => setView(o.value)}
          className={(current || "") === o.value ? "df-on" : undefined}
          aria-current={(current || "") === o.value ? "true" : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
