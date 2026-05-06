"use client";

// LIFF report picker — drill-down by ประเภทธุรกิจ
// feedback_filter_pattern_biztype_first.md — cards + dropdown + search
// feedback_collapse_all_button.md — ขยาย/ย่อทั้งหมด ที่ด้านบน

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { Badge } from "@/components/ui/badge";

export interface PickerBranch {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
  todayStatus?: string | null;
}

interface Props {
  branches: PickerBranch[];
  userName: string;
  roleLabel: string;
}

export function BranchPicker({ branches, userName, roleLabel }: Props) {
  const [query, setQuery] = useState("");
  // default: collapsed; auto-opens when query matches
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? branches.filter(
          (b) =>
            b.code.toLowerCase().includes(q) ||
            b.name.toLowerCase().includes(q) ||
            (b.province?.toLowerCase().includes(q) ?? false),
        )
      : branches;

    const map = new Map<string, PickerBranch[]>();
    for (const b of filtered) {
      const arr = map.get(b.business_type) ?? [];
      arr.push(b);
      map.set(b.business_type, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [branches, query]);

  // When query is set, auto-open all matched groups
  const effectiveOpen = useMemo(() => {
    if (query.trim()) {
      return Object.fromEntries(groups.map(([t]) => [t, true]));
    }
    return openTypes;
  }, [groups, openTypes, query]);

  const allOpen = groups.length > 0 && groups.every(([t]) => effectiveOpen[t]);

  function expandAll() {
    setOpenTypes(Object.fromEntries(groups.map(([t]) => [t, true])));
  }
  function collapseAll() {
    setOpenTypes({});
  }
  function toggleType(t: string) {
    setOpenTypes((o) => ({ ...o, [t]: !o[t] }));
  }

  return (
    <div className="p-4 max-w-md mx-auto safe-top safe-bottom pb-20">
      {/* Active account indicator — feedback_role_scoped_views.md */}
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-3 py-1.5">
        <div className="size-6 rounded-full bg-[var(--color-brand-600)] text-white flex items-center justify-center text-[10px] font-bold">
          {userName.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-semibold text-[var(--color-brand-900)]">
          {userName}
        </span>
        <span className="text-[11px] text-[var(--color-brand-700)]">
          · {roleLabel}
        </span>
      </div>

      <h1 className="text-2xl font-extrabold font-display tracking-[-0.02em] mb-1">
        เลือก<span className="text-gradient-blue">ประเภทธุรกิจ</span>
      </h1>
      <p className="text-sm text-zinc-500 mb-4">
        คุณดูแล {branches.length} สาขา · กดประเภทเพื่อเลือกสาขา
      </p>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="size-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา รหัส / ชื่อ / จังหวัด..."
          className="w-full h-11 pl-10 pr-9 rounded-xl border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 size-7 rounded-lg hover:bg-zinc-100 flex items-center justify-center"
            aria-label="Clear"
          >
            <X className="size-4 text-zinc-400" />
          </button>
        )}
      </div>

      {/* Expand/Collapse all — feedback_collapse_all_button.md */}
      {groups.length > 1 && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={allOpen ? collapseAll : expandAll}
            className="text-xs font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] inline-flex items-center gap-1"
          >
            {allOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                allOpen && "rotate-180",
              )}
            />
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 px-4 py-10 text-center">
          <p className="text-sm text-zinc-500">ไม่พบสาขาตามคำค้น</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(([type, list]) => {
            const cfg = BUSINESS_TYPES[type];
            const isOpen = !!effectiveOpen[type];
            const doneCount = list.filter(
              (b) =>
                b.todayStatus === "approved" || b.todayStatus === "submitted",
            ).length;
            return (
              <div
                key={type}
                className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleType(type)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50 transition-colors"
                >
                  <span className="text-2xl shrink-0">{cfg?.emoji ?? "📋"}</span>
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">
                      {cfg?.label ?? type}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {list.length} สาขา
                      {doneCount > 0 && (
                        <>
                          <span className="mx-1">·</span>
                          <span className="text-[var(--color-leaf-700)] font-semibold">
                            กรอกแล้ว {doneCount}/{list.length}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      "size-5 text-zinc-400 shrink-0 transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="border-t-2 border-zinc-100 bg-zinc-50/40 p-2 space-y-1.5">
                    {list.map((b) => {
                      const isDone =
                        b.todayStatus === "approved" ||
                        b.todayStatus === "submitted";
                      return (
                        <Link
                          key={b.id}
                          href={`/liff/report/${b.id}`}
                          className={cn(
                            "block rounded-xl px-3 py-2.5 transition-colors",
                            isDone
                              ? "bg-[var(--color-leaf-50)]/60 hover:bg-[var(--color-leaf-50)] border border-[var(--color-leaf-200)]"
                              : "bg-white hover:bg-[var(--color-brand-50)]/40 border border-zinc-200 hover:border-[var(--color-brand-300)]",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold tabular-num text-sm">
                                  {b.code}
                                </span>
                                {isDone && (
                                  <Badge tone="success">
                                    {b.todayStatus === "approved"
                                      ? "✓ อนุมัติ"
                                      : "✓ ส่งแล้ว"}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-zinc-600 truncate mt-0.5">
                                {b.name}
                              </div>
                              {b.province && (
                                <div className="text-[10px] text-zinc-500 mt-0.5">
                                  {b.province}
                                </div>
                              )}
                            </div>
                            <ChevronRight className="size-4 text-zinc-400 shrink-0" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
