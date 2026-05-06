"use client";

// Heatmap grid — client component
// feedback_popup_first_drilldown.md — กด cell → popup ห้าม navigate
// feedback_filter_pattern_biztype_first.md — แถวสาขาจัดกลุ่มตามประเภทธุรกิจ
// feedback_collapse_all_button.md — ขยาย/ย่อทั้งหมด

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { HeatmapCellModal } from "@/components/cashhub/heatmap-cell-modal";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

interface Props {
  branches: BranchRow[];
  /** branch_id → day-number → status */
  matrix: Record<string, Record<number, string>>;
  daysInMonth: number;
  todayDay: number;
  /** YYYY-MM (used to build date strings for cells) */
  monthYm: string;
  /** True if viewer can fill any branch (used for empty-cell quick-fill button) */
  canFill: boolean;
}

interface CellTarget {
  branchId: string;
  branchCode: string;
  date: string;
}

export function HeatmapGrid({
  branches,
  matrix,
  daysInMonth,
  todayDay,
  monthYm,
  canFill,
}: Props) {
  const [query, setQuery] = useState("");
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<CellTarget | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? branches.filter(
          (b) =>
            b.code.toLowerCase().includes(q) ||
            b.name.toLowerCase().includes(q),
        )
      : branches;

    const map = new Map<string, BranchRow[]>();
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
    <>
      {/* Toolbar — search + collapse-all */}
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="size-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา รหัส / ชื่อสาขา..."
            className="w-full h-10 pl-10 pr-9 rounded-xl border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
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
        {groups.length > 1 && (
          <button
            type="button"
            onClick={allOpen ? collapseAll : expandAll}
            className="text-sm font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-xl border-2 border-[var(--color-brand-200)] bg-white hover:bg-[var(--color-brand-50)]"
          >
            {allOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
          </button>
        )}
      </div>

      {/* Grouped heatmap */}
      <div className="space-y-2">
        {groups.map(([type, list]) => {
          const cfg = BUSINESS_TYPES[type];
          const isOpen = !!effectiveOpen[type];
          return (
            <div
              key={type}
              className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleType(type)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
              >
                <span className="text-xl shrink-0">{cfg?.emoji ?? "📋"}</span>
                <div className="text-left flex-1 min-w-0">
                  <div className="font-bold text-sm">
                    {cfg?.label ?? type}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {list.length} สาขา
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
                <div className="border-t-2 border-zinc-100 overflow-x-auto">
                  <table className="text-xs min-w-full">
                    <thead className="bg-zinc-50/50">
                      <tr className="border-b border-zinc-100">
                        <th className="text-left p-2 sticky left-0 bg-zinc-50 z-10 whitespace-nowrap">
                          สาขา
                        </th>
                        {Array.from(
                          { length: daysInMonth },
                          (_, i) => i + 1,
                        ).map((d) => (
                          <th
                            key={d}
                            className={cn(
                              "p-1 text-center font-semibold tabular-num text-[10px] w-7",
                              d === todayDay &&
                                "text-[var(--color-brand-700)] font-extrabold",
                            )}
                          >
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((b) => {
                        const m = matrix[b.id] ?? {};
                        return (
                          <tr key={b.id} className="border-b border-zinc-50">
                            <td className="p-2 sticky left-0 bg-white whitespace-nowrap font-medium">
                              {/* Click branch name = navigate to detail */}
                              <Link
                                href={`/cashhub/branches/${b.id}`}
                                className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-700)]"
                              >
                                <span className="tabular-num">{b.code}</span>
                              </Link>
                            </td>
                            {Array.from(
                              { length: daysInMonth },
                              (_, i) => i + 1,
                            ).map((d) => {
                              const isFuture = d > todayDay;
                              const status = m[d];
                              const dateStr = `${monthYm}-${String(d).padStart(2, "0")}`;
                              return (
                                <td
                                  key={d}
                                  className="p-0.5 text-center"
                                >
                                  {isFuture ? (
                                    <div
                                      className="size-5 mx-auto rounded-md bg-zinc-50"
                                      title={`${b.code} วันที่ ${d}`}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTarget({
                                          branchId: b.id,
                                          branchCode: b.code,
                                          date: dateStr,
                                        })
                                      }
                                      className={cn(
                                        "size-5 mx-auto rounded-md flex items-center justify-center transition-transform hover:scale-110 cursor-pointer",
                                        cellColor(status),
                                      )}
                                      title={`${b.code} วันที่ ${d}: ${statusLabel(status)}`}
                                      aria-label={`${b.code} วันที่ ${d}`}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Cell popup — feedback_popup_first_drilldown.md */}
      {target && (
        <HeatmapCellModal
          open={!!target}
          onClose={() => setTarget(null)}
          branchId={target.branchId}
          branchCode={target.branchCode}
          date={target.date}
          canFill={canFill}
        />
      )}
    </>
  );
}

function cellColor(status: string | undefined): string {
  if (status === "approved") return "bg-emerald-300 hover:bg-emerald-400";
  if (status === "submitted") return "bg-amber-200 hover:bg-amber-300";
  if (status === "rejected") return "bg-red-200 hover:bg-red-300";
  return "bg-zinc-100 hover:bg-zinc-200";
}

function statusLabel(status: string | undefined): string {
  if (status === "approved") return "อนุมัติ";
  if (status === "submitted") return "รออนุมัติ";
  if (status === "rejected") return "ปฏิเสธ";
  return "ไม่กรอก";
}
