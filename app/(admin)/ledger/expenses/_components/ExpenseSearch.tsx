"use client";

// ExpenseSearch — compact search box that lives NEXT TO the "รายจ่าย" title
// (LeanUX · CEO 2026-06-08 "ค้นหาเอาไปอยู่ข้างหัว"). Server-side GET form: preserves
// the active scope/filters via hidden inputs, submits ?q= on Enter / icon tap.
import { Search } from "lucide-react";

export function ExpenseSearch({
  baseParams,
  q,
  selectedId,
}: {
  baseParams: string;
  q?: string;
  selectedId?: string;
}) {
  return (
    <form method="GET" className="relative w-full sm:w-56">
      {baseParams
        .split("&")
        .filter(Boolean)
        .map((kv) => {
          const [k, v] = kv.split("=");
          if (k === "q") return null;
          return <input key={k} type="hidden" name={k} value={decodeURIComponent(v ?? "")} />;
        })}
      {selectedId && <input type="hidden" name="selected" value={selectedId} />}
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder="ค้นหา ผู้ขาย / เลขที่"
        aria-label="ค้นหารายจ่าย"
        className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
      />
    </form>
  );
}
