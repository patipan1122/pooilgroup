"use client";

// DocumentSortTabs — sort control for /docuflow/documents's "list" view
// ────────────────────────────────────────────────────────────────────
// CEO Pinpoint item #11 (2026-10-13): the main documents list had zero
// sort control — `loadDocuments()` always ordered by uploadedAt desc with
// no way to change it. Same URL-param + `.df-seg` contract as
// DocumentViewTabs (view switcher) and DocumentFilterSelect (filters) on
// this same page, so the choice round-trips through the URL — shareable/
// bookmarkable like every other control here, and the page re-renders via
// router.replace (no client-side re-sort, so pagination/limit stay correct).
// ────────────────────────────────────────────────────────────────────

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils/cn";

export type DocumentSortValue = "newest" | "oldest" | "name_asc";

const OPTIONS: { value: DocumentSortValue; label: string }[] = [
  { value: "newest", label: "ใหม่สุด" },
  { value: "oldest", label: "เก่าสุด" },
  { value: "name_asc", label: "ชื่อ ก-ฮ" },
];

interface Props {
  /** Currently-active `sort` value ("newest" = default, param omitted). */
  current: DocumentSortValue;
  /** Existing searchParams to preserve (filters/search/view etc.). */
  preserve?: Record<string, string>;
}

export function DocumentSortTabs({ current, preserve = {} }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function setSort(value: DocumentSortValue) {
    const sp = new URLSearchParams(preserve);
    if (value !== "newest") sp.set("sort", value);
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div
      className={cn("df-seg", pending && "opacity-70")}
      role="group"
      aria-label="เรียงลำดับ"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setSort(o.value)}
          className={current === o.value ? "df-on" : undefined}
          aria-current={current === o.value ? "true" : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
