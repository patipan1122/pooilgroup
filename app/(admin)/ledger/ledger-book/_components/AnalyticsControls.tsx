// Faceted controls for the spend-analytics book (flag LEDGER_ANALYTICS_V1).
//
// URL-driven (no client store) — every control rewrites a query param on the
// same route so the server re-runs spendPivot with the new facet. Keeps the page
// a server component; this island only pushes navigations.
//
// Facets — MULTI-SELECT (tick many; within a facet OR, across facets AND):
//   • q     — keyword search ("น้ำแข็ง") → switches the page into search mode
//   • ax    — row axis: สาขา | หมวด | ผู้ขาย | ผู้บันทึก (single)
//   • cat   — categories (repeated param)   ☑ ค่าไฟ ☑ ค่าน้ำ
//   • b     — branches   (repeated param)   ☑ ทองหล่อ ☑ เอกมัย   (legacy ?branch folded in)
//   • ven   — vendors    (repeated param)   ☑ การไฟฟ้า ☑ ...
//   • grain — รายเดือน | รายปี · basis — ก่อน VAT (net) | รวม VAT (gross)
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { RowAxis, TimeGrain, AmountBasis } from "@/lib/ledger/spend-analytics";

interface Opt {
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
  categoryIds,
  branchIds,
  vendors,
  grain,
  basis,
  search,
  categories,
  branches,
  vendorOptions,
}: {
  axis: RowAxis;
  categoryIds: string[];
  branchIds: string[];
  vendors: string[];
  grain: TimeGrain;
  basis: AmountBasis;
  search: string;
  categories: Opt[];
  branches: Opt[];
  vendorOptions: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [term, setTerm] = useState(search);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  // single-value params (grain/basis/ax/q)
  const setParam = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  };

  // multi-value param (repeated key). Touching branches clears the legacy single
  // ?branch so there's one source of truth.
  const setMultiParam = (key: string, values: string[]) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.delete(key);
    if (key === "b") params.delete("branch");
    for (const v of values) params.append(key, v);
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  };

  const toggleValue = (key: string, value: string, current: string[]) => {
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setMultiParam(key, [...set]);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParam({ q: term.trim() || null });
  };
  const clearSearch = () => {
    setTerm("");
    setParam({ q: null });
  };

  // id → name maps for the active-chip labels.
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  // active chips across all three facets (so the AND-combination is visible).
  const chips: { key: string; value: string; label: string }[] = [
    ...categoryIds.map((id) => ({ key: "cat", value: id, label: catName.get(id) ?? "หมวด" })),
    ...branchIds.map((id) => ({ key: "b", value: id, label: branchName.get(id) ?? "สาขา" })),
    ...vendors.map((v) => ({ key: "ven", value: v, label: v })),
  ];
  const clearAll = () => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.delete("cat");
    params.delete("b");
    params.delete("branch");
    params.delete("ven");
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
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
                onClick={() => setParam({ ax: opt.key })}
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

      {/* multi-select tick filters: หมวด · สาขา · ผู้ขาย */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-500">กรอง</span>
        <MultiPicker
          label="หมวด"
          options={categories}
          selected={categoryIds}
          isOpen={openPicker === "cat"}
          onOpenToggle={() => setOpenPicker((p) => (p === "cat" ? null : "cat"))}
          onToggle={(v) => toggleValue("cat", v, categoryIds)}
          onClear={() => setMultiParam("cat", [])}
        />
        <MultiPicker
          label="สาขา"
          options={branches}
          selected={branchIds}
          isOpen={openPicker === "b"}
          onOpenToggle={() => setOpenPicker((p) => (p === "b" ? null : "b"))}
          onToggle={(v) => toggleValue("b", v, branchIds)}
          onClear={() => setMultiParam("b", [])}
        />
        <MultiPicker
          label="ผู้ขาย"
          options={vendorOptions.map((v) => ({ id: v, name: v }))}
          selected={vendors}
          isOpen={openPicker === "ven"}
          onOpenToggle={() => setOpenPicker((p) => (p === "ven" ? null : "ven"))}
          onToggle={(v) => toggleValue("ven", v, vendors)}
          onClear={() => setMultiParam("ven", [])}
        />

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

      {/* active selections — the AND-combination, each removable */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={`${c.key}:${c.value}`}
              type="button"
              onClick={() => toggleValue(c.key, c.value, c.key === "cat" ? categoryIds : c.key === "b" ? branchIds : vendors)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] py-1 pl-2.5 pr-1.5 text-xs font-medium text-[var(--color-brand-700)]"
            >
              <span className="max-w-[10rem] truncate">{c.label}</span>
              <X className="size-3.5 text-[var(--color-brand-400)]" aria-hidden />
            </button>
          ))}
          {chips.length > 1 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-full px-2 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-700"
            >
              ล้างทั้งหมด
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Multi-select dropdown: a button (label + count) → a checkbox list popover with
// a search box for long lists (vendors). Tap toggles a value in the URL.
// --------------------------------------------------------------------------
function MultiPicker({
  label,
  options,
  selected,
  isOpen,
  onOpenToggle,
  onToggle,
  onClear,
}: {
  label: string;
  options: Opt[];
  selected: string[];
  isOpen: boolean;
  onOpenToggle: () => void;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState("");
  const count = selected.length;
  const sel = new Set(selected);
  const showSearch = options.length > 8;
  const shown = filter.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : options;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onOpenToggle}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-2.5 text-sm font-medium transition-colors",
          count > 0
            ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
            : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
        )}
      >
        {label}
        {count > 0 && (
          <span className="grid min-w-[18px] place-items-center rounded-full bg-[var(--color-brand-600)] px-1 text-[11px] font-bold text-white">
            {count}
          </span>
        )}
        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
      </button>

      {isOpen && (
        <>
          {/* click-away */}
          <button
            type="button"
            aria-label="ปิดตัวเลือก"
            tabIndex={-1}
            onClick={onOpenToggle}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            aria-label={label}
            className="absolute left-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
          >
            {showSearch && (
              <div className="border-b border-zinc-100 p-2">
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`ค้นหา${label}…`}
                  aria-label={`ค้นหา${label}`}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:border-[var(--color-brand-400)]"
                />
              </div>
            )}
            <ul className="max-h-64 overflow-y-auto py-1">
              {shown.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-zinc-400">ไม่พบรายการ</li>
              ) : (
                shown.map((o) => {
                  const on = sel.has(o.id);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => onToggle(o.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded border",
                            on
                              ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white"
                              : "border-zinc-300 bg-white",
                          )}
                        >
                          {on && <Check className="size-3" aria-hidden />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            {count > 0 && (
              <div className="border-t border-zinc-100 p-1.5">
                <button
                  type="button"
                  onClick={onClear}
                  className="w-full rounded-lg py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50"
                >
                  ล้าง{label} ({count})
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </span>
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
