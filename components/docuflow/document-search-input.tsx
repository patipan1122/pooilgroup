"use client";

// DocumentSearchInput — free-text search box for /docuflow/documents
// ────────────────────────────────────────────────────────────────────
// CEO feedback 2026-10-11: the `search` query param + loadDocuments'
// name/description `contains` match already existed end-to-end
// (lib/docuflow/data.ts) but had no visible input to type into — only
// reachable by hand-editing the URL. This is the missing UI piece, same
// URL-driven contract as DocumentFilterSelect (router.replace, preserves
// other params) but debounced since it's free text, not a discrete choice.
// ────────────────────────────────────────────────────────────────────

import { useRouter, usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Search } from "lucide-react";

interface Props {
  /** Current `search` value from the URL (server-rendered initial value) */
  current: string;
  /** Existing searchParams to preserve (everything except `search`) */
  preserve?: Record<string, string>;
}

export function DocumentSearchInput({ current, preserve = {} }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(current);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in sync if the URL changes from elsewhere (e.g. a filter
  // reset link) without fighting the user's own typing. Adjusted during
  // render (React's documented pattern for "reset state when a prop
  // changes") instead of in an effect, which would cause an extra render
  // pass — see react-hooks/set-state-in-effect.
  const [prevCurrent, setPrevCurrent] = useState(current);
  if (current !== prevCurrent) {
    setPrevCurrent(current);
    setValue(current);
  }

  function navigate(next: string) {
    const sp = new URLSearchParams(preserve);
    if (next.trim()) sp.set("search", next.trim());
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate(next), 400);
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-zinc-500 tracking-wide">
        ค้นหาเอกสาร
      </span>
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="พิมพ์ชื่อเอกสาร..."
          className="h-9 w-full rounded-lg border-2 border-zinc-200 bg-white pl-8 pr-2.5 text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
        />
      </div>
    </label>
  );
}
