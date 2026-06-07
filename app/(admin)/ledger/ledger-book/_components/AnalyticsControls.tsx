// Faceted controls for the spend-analytics book (flag LEDGER_ANALYTICS_V1).
//
// URL-driven (no client store) — mirrors AxisToggle: every control rewrites a
// query param on the same route so the server re-runs spendPivot with the new
// facet. Keeps the page a server component; this island only pushes navigations.
//
// Facets (all AND-combined → "ค่าไฟ + สาขาทองหล่อ ย้อนหลัง"):
//   • q     — keyword search ("น้ำแข็ง") → switches the page into search mode
//   • ax    — row axis: สาขา | หมวด | ผู้ขาย | ผู้บันทึก
//   • cat   — category filter (single-select; the บริษัท/สาขา picker lives in the header)
//   • grain — รายเดือน | รายปี
//   • basis — ก่อน VAT (net) | รวม VAT (gross)
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { RowAxis, TimeGrain, AmountBasis } from "@/lib/ledger/spend-analytics";

interface CatOpt {
  id: string;
  name: string;
}

const AXES: ReadonlyArray<{ key: RowAxis; label: string }> = [
  { key: "branch", label: "สาขา" },
  { key: "category", label: "หมวด" },
  { key: "vendor", label: "ผู้ขาย" },
  { key: "person", label: "ผู้บันทึก" },
];

export function AnalyticsControls({
  axis,
  categoryId,
  grain,
  basis,
  search,
  categories,
}: {
  axis: RowAxis;
  categoryId: string | null;
  grain: TimeGrain;
  basis: AmountBasis;
  search: string;
  categories: CatOpt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [term, setTerm] = useState(search);

  const setParam = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParam({ q: term.trim() || null });
  };
  const clearSearch = () => {
    setTerm("");
    setParam({ q: null });
  };

  return (
    <div className="mb-4 space-y-3">
      {/* keyword search — "ล่าสุดซื้อ X กี่บาท" */}
      <form onSubmit={submitSearch} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="ค้นสินค้า/ผู้ขาย เช่น น้ำแข็ง → ดูราคาล่าสุด"
          aria-label="ค้นหาสินค้าหรือผู้ขาย"
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-9 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-[var(--color-brand-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        />
        {term && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="ล้างคำค้น"
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </form>

      {/* axis: ดูตาม ... */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-500">ดูตาม</span>
        <div role="tablist" aria-label="แกนของตาราง" className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          {AXES.map((opt) => {
            const active = axis === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParam({ ax: opt.key === "branch" ? null : opt.key })}
                className={cn(
                  "min-h-[36px] rounded-lg px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-white text-[var(--color-brand-700)] shadow-sm ring-1 ring-zinc-200"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* filters: หมวด + grain + basis */}
      <div className="flex flex-wrap items-center gap-2">
        {/* category filter */}
        <label className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500">หมวด</span>
          <select
            value={categoryId ?? ""}
            onChange={(e) => setParam({ cat: e.target.value || null })}
            className="min-h-[36px] max-w-[10rem] rounded-xl border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-800 focus:border-[var(--color-brand-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            <option value="">ทุกหมวด</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {/* grain toggle */}
        <Segmented
          ariaLabel="ช่วงเวลา"
          value={grain}
          options={[
            { key: "month", label: "รายเดือน" },
            { key: "year", label: "รายปี" },
          ]}
          onSelect={(v) => setParam({ grain: v === "month" ? null : v })}
        />

        {/* basis toggle */}
        <Segmented
          ariaLabel="ฐานยอดเงิน"
          value={basis}
          options={[
            { key: "net", label: "ก่อน VAT" },
            { key: "gross", label: "รวม VAT" },
          ]}
          onSelect={(v) => setParam({ basis: v === "net" ? null : v })}
        />
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  ariaLabel,
  value,
  options,
  onSelect,
}: {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onSelect: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(opt.key)}
            className={cn(
              "min-h-[36px] rounded-lg px-3 text-sm font-medium transition-colors",
              active
                ? "bg-white text-[var(--color-brand-700)] shadow-sm ring-1 ring-zinc-200"
                : "text-zinc-500 hover:text-zinc-800",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
