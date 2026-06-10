"use client";

// Smart branch picker: type-chip filter → filtered select + search.
// - Chips group branches by businessType (horizontal scroll on mobile)
// - If a type has exactly 1 branch → clicking the chip auto-selects it
// - Search box filters by name/code across all types
// - Falls back to plain select if branches is empty

import { useState, useMemo, useEffect } from "react";
import { Search, X } from "lucide-react";

export interface BranchOpt {
  id: string;
  code: string;
  name: string;
  businessType: string;
}

const BT_LABEL: Record<string, string> = {
  cafe: "กาแฟ/เครื่องดื่ม",
  cafe_punthai: "พันธุ์ไทย",
  claw_machine: "ตู้คีบ",
  hotel: "โรงแรม",
  massage_chair: "เก้าอี้นวด",
  fuel_station: "ปั๊มน้ำมัน",
  lpg_station: "ปั๊มแก๊ส",
  lpg_retail: "ร้านแก๊ส",
  bottling_plant: "โรงบรรจุก๊าซ",
  convenience_store: "พื้นที่เช่า",
  ev_station: "EV Station",
  training_center: "ศูนย์ฝึก",
  transport: "ขนส่ง",
};

function btLabel(type: string) {
  return BT_LABEL[type] ?? type;
}

export function BranchPicker({
  branches,
  value,
  onChange,
  className = "",
  placeholder = "— เลือกสาขา —",
  disabled = false,
}: {
  branches: BranchOpt[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string>(""); // "" = ทั้งหมด

  // Unique business types present in the branch list (preserves order of first appearance)
  const types = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of branches) {
      if (!seen.has(b.businessType)) {
        seen.add(b.businessType);
        out.push(b.businessType);
      }
    }
    return out;
  }, [branches]);

  // When switching type → auto-select if only 1 branch in that type
  function handleTypeClick(type: string) {
    setSearch("");
    if (activeType === type) {
      setActiveType(""); // deselect
      return;
    }
    setActiveType(type);
    const inType = branches.filter((b) => b.businessType === type);
    if (inType.length === 1) {
      onChange(inType[0].id);
    }
  }

  // Clear search
  function clearSearch() {
    setSearch("");
  }

  // Filtered branches: search takes precedence over type chip
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return branches.filter((b) =>
      b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q)
    );
    if (activeType) return branches.filter((b) => b.businessType === activeType);
    return branches;
  }, [branches, search, activeType]);

  // When search clears the filter to 1 item, don't auto-select (user hasn't confirmed)
  const isAutoSelected =
    !search && activeType && branches.filter((b) => b.businessType === activeType).length === 1;

  if (branches.length === 0) {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={
          "h-11 w-full rounded-lg border border-zinc-200 px-2 text-base focus:border-[var(--color-brand-400)] focus:outline-none disabled:opacity-50 sm:text-sm " +
          className
        }
      >
        <option value="">ยังไม่มีสาขา</option>
      </select>
    );
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-50 " + className : className}>
      {/* Type chip rail — only show when >1 type exists */}
      {types.length > 1 && !search && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => { setActiveType(""); }}
            className={
              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
              (activeType === ""
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300")
            }
          >
            ทั้งหมด
          </button>
          {types.map((t) => {
            const count = branches.filter((b) => b.businessType === t).length;
            const isActive = activeType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleTypeClick(t)}
                className={
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
                  (isActive
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300")
                }
              >
                {btLabel(t)}{count > 1 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setActiveType(""); }}
          placeholder="ค้นหาสาขา..."
          className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-8 text-base outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-brand-200)] sm:h-9 sm:text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-600"
            aria-label="ล้างการค้นหา"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Auto-selected badge (single branch in type) */}
      {isAutoSelected ? (
        <div className="flex h-11 items-center gap-2 rounded-lg border border-[var(--color-brand-300)] bg-[var(--color-brand-50)] px-3 text-sm font-medium text-[var(--color-brand-800)]">
          <span className="flex-1 truncate">
            {branches.find((b) => b.businessType === activeType)?.name ?? ""}
          </span>
          <button
            type="button"
            onClick={() => { setActiveType(""); onChange(""); }}
            className="shrink-0 text-zinc-500 hover:text-zinc-600"
            aria-label="เปลี่ยนสาขา"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base focus:border-[var(--color-brand-400)] focus:outline-none sm:text-sm"
        >
          <option value="">{placeholder}</option>
          {filtered.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {filtered.length === 0 && search && (
        <p className="mt-1 text-[11px] text-zinc-500">ไม่พบสาขาที่ค้นหา</p>
      )}
    </div>
  );
}
