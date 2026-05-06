"use client";

// Branch multi-select picker.
// Used in invite forms + edit forms to pick which branches a user manages.
//
// UX rules:
//   - Group by business type (collapsible) — flat 100+ checkboxes is unusable
//   - Search box filters across code/name/business-type
//   - Per-group "เลือกทั้งกลุ่ม" toggle
//   - Default: all groups collapsed (only summary visible)
//   - Footer shows N selected + ขยายทั้งหมด/ย่อทั้งหมด toggle (project rule)

import { useState, useMemo } from "react";
import { ChevronDown, Search, X as XIcon, Check } from "lucide-react";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { cn } from "@/lib/utils/cn";

export interface BranchOption {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

interface Props {
  branches: BranchOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Optional — show "เลือก X" badge in header */
  showCount?: boolean;
}

export function BranchPicker({
  branches,
  selected,
  onChange,
  showCount = true,
}: Props) {
  const [query, setQuery] = useState("");
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());

  // Group branches by business_type, sorted by branch count desc
  const groups = useMemo(() => {
    const m = new Map<string, BranchOption[]>();
    for (const b of branches) {
      if (!m.has(b.business_type)) m.set(b.business_type, []);
      m.get(b.business_type)!.push(b);
    }
    // sort branches inside group by code
    for (const arr of m.values()) {
      arr.sort((a, b) => a.code.localeCompare(b.code));
    }
    return Array.from(m.entries()).sort(
      (a, b) => b[1].length - a[1].length,
    );
  }, [branches]);

  // Filter by query — match code / name / business-type label
  const q = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map(([type, list]) => {
        const cfg = BUSINESS_TYPES[type];
        const typeLabel = (cfg?.label ?? type).toLowerCase();
        const filtered = list.filter((b) => {
          const hay = `${b.code} ${b.name} ${typeLabel}`.toLowerCase();
          return hay.includes(q);
        });
        return [type, filtered] as const;
      })
      .filter(([, list]) => list.length > 0);
  }, [groups, q]);

  // When searching, auto-expand groups with matches
  const effectiveOpenTypes = q
    ? new Set(filteredGroups.map(([t]) => t))
    : openTypes;

  function toggleType(type: string) {
    if (q) return; // can't manually toggle while searching
    const next = new Set(openTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setOpenTypes(next);
  }

  function toggleBranch(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleGroup(typeBranches: BranchOption[]) {
    const allIn = typeBranches.every((b) => selected.has(b.id));
    const next = new Set(selected);
    if (allIn) typeBranches.forEach((b) => next.delete(b.id));
    else typeBranches.forEach((b) => next.add(b.id));
    onChange(next);
  }

  function expandAll() {
    setOpenTypes(new Set(groups.map(([t]) => t)));
  }
  function collapseAll() {
    setOpenTypes(new Set());
  }
  function selectAll() {
    onChange(new Set(branches.map((b) => b.id)));
  }
  function clearAll() {
    onChange(new Set());
  }

  const allExpanded =
    openTypes.size === groups.length && groups.length > 0;
  const totalSelected = selected.size;

  return (
    <div className="space-y-2">
      {/* Search + global actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา รหัส / ชื่อ / ประเภทธุรกิจ"
            className="w-full h-9 pl-9 pr-9 rounded-lg border border-zinc-200 bg-white text-sm outline-none focus:border-[var(--color-brand-500)] placeholder:text-zinc-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        {showCount && (
          <span className="text-[11px] font-bold tabular-num px-2 py-1 rounded-md bg-[var(--color-brand-50)] text-[var(--color-brand-800)] border border-[var(--color-brand-200)]">
            เลือก {totalSelected}
          </span>
        )}
      </div>

      {/* Mini action bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <button
          type="button"
          onClick={selectAll}
          className="font-semibold hover:text-[var(--color-brand-700)]"
        >
          เลือกทั้งหมด ({branches.length})
        </button>
        <span className="text-zinc-300">·</span>
        <button
          type="button"
          onClick={clearAll}
          disabled={totalSelected === 0}
          className="font-semibold hover:text-[var(--color-brand-700)] disabled:text-zinc-300 disabled:cursor-default"
        >
          ล้างทั้งหมด
        </button>
        <span className="text-zinc-300">·</span>
        <button
          type="button"
          onClick={allExpanded ? collapseAll : expandAll}
          disabled={!!q}
          className="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-brand-700)] disabled:text-zinc-300 disabled:cursor-default"
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              allExpanded && "rotate-180",
            )}
          />
          {allExpanded ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
        </button>
      </div>

      {/* Empty state */}
      {filteredGroups.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-6 text-center text-sm text-zinc-500">
          {q ? `ไม่พบสาขาที่ตรงกับ "${q}"` : "ไม่มีสาขา"}
        </div>
      )}

      {/* Groups */}
      <div className="space-y-1.5">
        {filteredGroups.map(([type, list]) => {
          const cfg = BUSINESS_TYPES[type];
          const isOpen = effectiveOpenTypes.has(type);
          const selectedInGroup = list.filter((b) => selected.has(b.id)).length;
          const allInGroup = selectedInGroup === list.length;
          const someInGroup = selectedInGroup > 0 && !allInGroup;

          return (
            <div
              key={type}
              className={cn(
                "rounded-xl border bg-white overflow-hidden",
                someInGroup || allInGroup
                  ? "border-[var(--color-brand-300)]"
                  : "border-zinc-200",
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 transition-colors">
                {/* Group select-all checkbox */}
                <input
                  type="checkbox"
                  checked={allInGroup}
                  ref={(el) => {
                    if (el) el.indeterminate = someInGroup;
                  }}
                  onChange={() => toggleGroup(list)}
                  className="size-4 shrink-0 cursor-pointer accent-[var(--color-brand-600)]"
                  aria-label={`เลือกทั้งกลุ่ม ${cfg?.label ?? type}`}
                />
                <button
                  type="button"
                  onClick={() => toggleType(type)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  <span className="text-base">{cfg?.emoji ?? "📋"}</span>
                  <span className="font-extrabold font-display text-sm text-zinc-900 truncate">
                    {cfg?.label ?? type}
                  </span>
                  <span className="text-[11px] text-zinc-500 ml-1 tabular-num">
                    {selectedInGroup > 0 ? (
                      <>
                        <span className="font-bold text-[var(--color-brand-700)]">
                          {selectedInGroup}
                        </span>
                        <span className="text-zinc-400"> / </span>
                        {list.length} สาขา
                      </>
                    ) : (
                      <>{list.length} สาขา</>
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 text-zinc-400 transition-transform shrink-0 ml-auto",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-zinc-100 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-zinc-50">
                  {list.map((b) => {
                    const checked = selected.has(b.id);
                    return (
                      <label
                        key={b.id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-50 transition-colors min-w-0",
                          checked && "bg-[var(--color-brand-50)]/50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBranch(b.id)}
                          className="size-3.5 shrink-0 accent-[var(--color-brand-600)]"
                        />
                        <span className="text-xs font-extrabold tabular-num font-display text-zinc-900 shrink-0">
                          {b.code}
                        </span>
                        <span className="text-xs text-zinc-700 truncate">
                          {b.name}
                        </span>
                        {checked && (
                          <Check className="size-3 text-[var(--color-brand-600)] ml-auto shrink-0" />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
