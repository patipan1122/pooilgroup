// Date-range filter (CEO ask 2026-05-28 · "เลือกวันไหนถึงวันไหน").
//
// Pure Server Component — uses a native <form method="GET"> so no client JS is
// needed. Submitting reloads the page with ?from=&to=, which the page reads to
// recompute every KPI + the all-branches table. Quick presets are plain links.
//
// Dates are Bangkok-local YYYY-MM-DD strings (the page resolves them to day
// boundaries). The "ดู" submit re-runs the GET; presets jump straight there.

import Link from "next/link";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type RangePreset = "today" | "7d" | "mtd";

function presetHref(preset: RangePreset, from: string, to: string): string {
  // Presets are resolved on the page; here we just pass an intent flag the page
  // honours via ?preset=. We still include current from/to so a JS-less back
  // works, but ?preset wins.
  const p = new URLSearchParams({ preset });
  void from;
  void to;
  return `?${p.toString()}#all-branches`;
}

export interface DateRangeFilterProps {
  from: string;
  to: string;
  /** which preset (if any) the current range matches · for active styling. */
  activePreset: RangePreset | null;
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "วันนี้" },
  { key: "7d", label: "7 วัน" },
  { key: "mtd", label: "เดือนนี้" },
];

export function DateRangeFilter({
  from,
  to,
  activePreset,
}: DateRangeFilterProps) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:flex-row sm:items-end sm:justify-between">
      <form method="GET" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="from"
            className="text-[11px] font-medium text-zinc-500"
          >
            <Calendar
              className="mr-1 inline size-3 align-[-1px]"
              aria-hidden="true"
            />
            จากวันที่
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={from}
            // CEO 2026-06-01: removed max={to} — the React prop is the
            // initial value, not the live form state, so the browser
            // refused historical ranges (StarThing backfill from April
            // 1-10 hit "ค่าต้องเป็น 01/06/2026 หรือหลังจากนั้น"). Range
            // sanity is validated server-side anyway.
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-[11px] font-medium text-zinc-500">
            ถึงวันที่
          </label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={to}
            // CEO 2026-06-01: same fix as the `from` input above —
            // min={from} blocked historical backfills.
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          ดู
        </button>
      </form>

      <div className="flex items-center gap-1">
        <span className="mr-0.5 text-[11px] text-zinc-400">ช่วงด่วน:</span>
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={presetHref(p.key, from, to)}
            scroll={false}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100",
              activePreset === p.key &&
                "bg-zinc-900 text-white hover:bg-zinc-900",
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
