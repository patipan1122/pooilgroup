// ExecutiveTable v2 — รายเดือน / รายวัน + expand แต่ละแถวดูสาขา
//
// Brand DNA: ฟ้า + ขาว + เทา หลัก. เขียว/แดง = trend ↑/↓ binary.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Calendar,
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatBahtCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { ExecutiveMatrix, Period } from "@/lib/cashhub/executive-matrix";

interface Props {
  data: ExecutiveMatrix;
}

export function ExecutiveTable({ data }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const allExpanded = expanded.size === data.rows.length;
  const noneExpanded = expanded.size === 0;

  function expandAll() {
    setExpanded(new Set(data.rows.map((r) => r.businessType)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  // Reverse arrays so OLDEST → NEWEST (left → right, like calendar)
  const periodLabels = [...data.periodLabels].reverse();
  const periodTotals = [...data.periodTotals].reverse();
  const rowsByType = data.rows.map((r) => ({
    ...r,
    totals: [...r.totals].reverse(),
    branches: r.branches.map((b) => ({
      ...b,
      totals: [...b.totals].reverse(),
    })),
  }));

  // Newest = last index. Compute change %
  const totalsChangePct = periodTotals.map((cur, i) => {
    if (i === 0) return null;
    const prev = periodTotals[i - 1];
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
  });

  function toggleExpand(bt: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(bt)) next.delete(bt);
      else next.add(bt);
      return next;
    });
  }

  function setPeriod(p: Period) {
    startTransition(() => {
      const url = new URL(window.location.href);
      if (p === "monthly") url.searchParams.delete("view");
      else url.searchParams.set("view", "daily");
      router.push(url.pathname + url.search);
    });
  }

  const isDaily = data.period === "daily";

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
      {/* Filter bar — left: period toggle · right: expand/collapse all */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 sm:px-5 py-3 border-b-2 border-zinc-100 bg-zinc-50/40">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-600 font-bold">
            ดูแบบ
          </span>
          <PeriodToggle current={data.period} onChange={setPeriod} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-bold rounded-lg border-2 border-zinc-200 bg-white text-zinc-700 hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-700)] transition-colors"
          >
            {allExpanded ? (
              <>
                <ChevronsDownUp className="size-3.5" />
                หุบทั้งหมด
              </>
            ) : (
              <>
                <ChevronsUpDown className="size-3.5" />
                ขยายทั้งหมด
              </>
            )}
          </button>
          {!noneExpanded && !allExpanded && (
            <button
              type="button"
              onClick={collapseAll}
              className="text-xs text-zinc-600 hover:text-zinc-900 font-semibold underline underline-offset-2"
            >
              หุบ {expanded.size}
            </button>
          )}
        </div>
      </div>
      <div className="px-4 sm:px-5 py-2 border-b border-zinc-100 text-[11px] text-zinc-600 flex items-center justify-between bg-white">
        <span>{isDaily ? "30 วันล่าสุด" : "12 เดือนล่าสุด (1 ปีเต็ม)"}</span>
        <span className="text-zinc-500">↔ เลื่อนซ้ายขวาดูช่วงเก่า</span>
      </div>

      {/* Table — horizontal scroll */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="bg-white border-b-2 border-zinc-100">
              <th
                className="text-left px-3 sm:px-4 py-3 font-bold text-zinc-600 sticky left-0 bg-white z-10 min-w-[200px] sm:min-w-[240px]"
                style={{ borderRight: "1px solid var(--color-border)" }}
              >
                <span className="text-[10px] uppercase tracking-widest text-zinc-400">
                  ประเภทธุรกิจ
                </span>
              </th>
              {periodLabels.map((label, i) => {
                const isLatest = i === periodLabels.length - 1;
                return (
                  <th
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-3 font-bold text-right tabular-num min-w-[80px] sm:min-w-[96px]",
                      isLatest
                        ? "text-[var(--color-brand-700)] bg-[var(--color-brand-50)]/40"
                        : "text-zinc-500",
                    )}
                  >
                    {label}
                    {isLatest && (
                      <span className="block text-[9px] text-[var(--color-brand-600)] font-normal mt-0.5">
                        {isDaily ? "วันนี้" : "เดือนนี้"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowsByType.map((row, rowIdx) => {
              const cfg = BUSINESS_TYPES[row.businessType];
              const isExpanded = expanded.has(row.businessType);
              return (
                <BusinessTypeRow
                  key={row.businessType}
                  row={row}
                  cfg={cfg}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(row.businessType)}
                  rowIdx={rowIdx}
                  onNavigateBranch={(branchId) =>
                    startTransition(() => router.push(`/branches/${branchId}`))
                  }
                />
              );
            })}

            {/* Footer row — totals */}
            <tr className="border-t-2 border-zinc-300 bg-[var(--color-brand-50)]/30 font-bold">
              <td
                className="px-3 sm:px-4 py-3 sticky left-0 bg-[var(--color-brand-50)] z-10"
                style={{ borderRight: "1px solid var(--color-border)" }}
              >
                <div className="text-[10px] uppercase tracking-widest text-[var(--color-brand-700)] font-bold">
                  รวมทั้งหมด
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  ทุกประเภทธุรกิจ
                </div>
              </td>
              {periodTotals.map((total, i) => {
                const isLatest = i === periodTotals.length - 1;
                const pct = totalsChangePct[i];
                return (
                  <td
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-3 text-right tabular-num",
                      isLatest && "bg-[var(--color-brand-100)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "font-extrabold",
                        isLatest
                          ? "text-[var(--color-brand-800)]"
                          : "text-zinc-800",
                      )}
                    >
                      {total > 0 ? formatBahtCompact(total) : "—"}
                    </div>
                    {pct !== null && total > 0 && (
                      <div
                        className={cn(
                          "text-[10px] font-bold tabular-num inline-flex items-center gap-0.5",
                          pct > 0
                            ? "text-[var(--color-leaf-700)]"
                            : pct < 0
                              ? "text-[var(--color-danger)]"
                              : "text-zinc-400",
                        )}
                      >
                        {pct > 0 ? (
                          <TrendingUp className="size-2.5" />
                        ) : pct < 0 ? (
                          <TrendingDown className="size-2.5" />
                        ) : null}
                        {pct > 0 ? "+" : ""}
                        {pct.toFixed(0)}%
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer hint */}
      <div className="px-4 sm:px-5 py-2.5 border-t border-zinc-100 bg-zinc-50/40 text-[11px] text-zinc-500 flex items-center justify-between">
        <span>เลื่อนซ้ายขวาดูช่วงอื่น · กดแถวเพื่อขยายดูสาขา</span>
        <span className="hidden sm:inline">
          {expanded.size > 0 && `ขยาย ${expanded.size} ประเภท`}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   Business type row + expanded branches
   ============================================================ */
function BusinessTypeRow({
  row,
  cfg,
  isExpanded,
  onToggle,
  rowIdx,
  onNavigateBranch,
}: {
  row: {
    businessType: string;
    totals: number[];
    branchCount: number;
    branches: Array<{ id: string; code: string; name: string; totals: number[] }>;
  };
  cfg: { emoji: string; label: string } | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  rowIdx: number;
  onNavigateBranch: (branchId: string) => void;
}) {
  return (
    <>
      <tr
        className={cn(
          "border-b border-zinc-100 transition-colors cursor-pointer",
          rowIdx % 2 === 1 && !isExpanded && "bg-zinc-50/40",
          isExpanded
            ? "bg-[var(--color-brand-50)]/40"
            : "hover:bg-[var(--color-brand-50)]/30",
        )}
        onClick={onToggle}
      >
        <td
          className="px-3 sm:px-4 py-2.5 sticky left-0 bg-inherit z-10"
          style={{ borderRight: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <ChevronDown
              className={cn(
                "size-4 text-zinc-400 transition-transform shrink-0",
                isExpanded ? "rotate-0" : "-rotate-90",
              )}
            />
            <span className="text-base shrink-0">{cfg?.emoji ?? "📋"}</span>
            <div className="min-w-0">
              <div className="font-semibold text-zinc-900 truncate">
                {cfg?.label ?? row.businessType}
              </div>
              <div className="text-[10px] text-zinc-400 tabular-num">
                {row.branchCount} สาขา
              </div>
            </div>
          </div>
        </td>
        {row.totals.map((val, i) => {
          const isLatest = i === row.totals.length - 1;
          const prev = i > 0 ? row.totals[i - 1] : 0;
          const showDiff = i > 0 && prev > 0;
          const pct = showDiff ? ((val - prev) / prev) * 100 : null;
          return (
            <td
              key={i}
              className={cn(
                "px-2 sm:px-3 py-2.5 text-right tabular-num",
                isLatest && "bg-[var(--color-brand-50)]/30",
                val === 0 && "text-zinc-300",
              )}
            >
              <div
                className={cn(
                  "font-semibold",
                  isLatest ? "text-[var(--color-brand-800)]" : "text-zinc-700",
                )}
              >
                {val > 0 ? formatBahtCompact(val) : "—"}
              </div>
              {pct !== null && val > 0 && (
                <div
                  className={cn(
                    "text-[10px] font-bold tabular-num",
                    pct > 0
                      ? "text-[var(--color-leaf-700)]"
                      : pct < 0
                        ? "text-[var(--color-danger)]"
                        : "text-zinc-400",
                  )}
                >
                  {pct > 0 ? "+" : ""}
                  {pct.toFixed(0)}%
                </div>
              )}
            </td>
          );
        })}
      </tr>

      {/* Expanded branch sub-rows — use Next router for SPA navigation */}
      {isExpanded &&
        row.branches.map((b, bIdx) => (
          <tr
            key={b.id}
            className={cn(
              "border-b border-zinc-100 bg-[var(--color-brand-50)]/20 hover:bg-[var(--color-brand-50)]/40 transition-colors",
              bIdx === row.branches.length - 1 && "border-b-2 border-[var(--color-brand-200)]",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateBranch(b.id);
            }}
            style={{ cursor: "pointer" }}
          >
            <td
              className="px-3 sm:px-4 py-2 sticky left-0 bg-inherit z-10"
              style={{ borderRight: "1px solid var(--color-border)" }}
            >
              <div className="flex items-center gap-2 min-w-0 pl-7">
                <span className="text-zinc-300 text-sm">└</span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-zinc-700 truncate tabular-num">
                    {b.code}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {b.name}
                  </div>
                </div>
              </div>
            </td>
            {b.totals.map((val, i) => {
              const isLatest = i === b.totals.length - 1;
              return (
                <td
                  key={i}
                  className={cn(
                    "px-2 sm:px-3 py-2 text-right tabular-num text-xs",
                    isLatest && "bg-[var(--color-brand-50)]/40",
                    val === 0 && "text-zinc-300",
                  )}
                >
                  <span
                    className={cn(
                      isLatest
                        ? "text-[var(--color-brand-700)] font-semibold"
                        : "text-zinc-600",
                    )}
                  >
                    {val > 0 ? formatBahtCompact(val) : "—"}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
    </>
  );
}

/* ============================================================
   Period toggle (รายเดือน / รายวัน)
   ============================================================ */
function PeriodToggle({
  current,
  onChange,
}: {
  current: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border-2 border-zinc-200 bg-white p-0.5">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 h-8 text-xs font-bold rounded transition-colors",
          current === "monthly"
            ? "bg-[var(--color-brand-600)] text-white"
            : "text-zinc-600 hover:bg-zinc-50",
        )}
      >
        <Calendar className="size-3.5" />
        รายเดือน
      </button>
      <button
        type="button"
        onClick={() => onChange("daily")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 h-8 text-xs font-bold rounded transition-colors",
          current === "daily"
            ? "bg-[var(--color-brand-600)] text-white"
            : "text-zinc-600 hover:bg-zinc-50",
        )}
      >
        <CalendarDays className="size-3.5" />
        รายวัน
      </button>
    </div>
  );
}
