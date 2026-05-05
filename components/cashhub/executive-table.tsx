// ExecutiveTable — compact data-dense table for owner/board overview
// Rows: business types · Columns: months (slidable horizontally)
// Footer: totals + month-over-month change %
//
// Per Brand DNA: ฟ้า + ขาว + เทา หลัก. เขียว/แดงเฉพาะ trend ↑/↓ (binary "ขึ้น/ลง")

"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatBahtCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { ExecutiveMatrix } from "@/lib/cashhub/executive-matrix";

interface Props {
  data: ExecutiveMatrix;
}

type ViewMode = "compare" | "ratio";

export function ExecutiveTable({ data }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("compare");
  const [scrollOffset, setScrollOffset] = useState(0);

  // Reverse arrays so OLDEST → NEWEST (left → right, like calendar)
  const monthKeys = [...data.monthKeys].reverse();
  const monthLabels = [...data.monthLabels].reverse();
  const monthlyTotals = [...data.monthlyTotals].reverse();
  const rowsByType = data.rows.map((r) => ({
    ...r,
    totals: [...r.totals].reverse(),
  }));

  // Recompute change% (newest month = last index)
  const changePct = monthlyTotals.map((cur, i) => {
    if (i === 0) return null;
    const prev = monthlyTotals[i - 1];
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
  });

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 sm:px-5 py-3 border-b-2 border-zinc-100 bg-zinc-50/40">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
            มุมมอง
          </span>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-zinc-500">
          <button
            type="button"
            onClick={() => setScrollOffset((v) => Math.min(v + 1, monthKeys.length - 3))}
            disabled={scrollOffset >= monthKeys.length - 3}
            className="size-7 rounded-lg border border-zinc-200 bg-white hover:border-[--color-brand-300] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
            aria-label="ก่อนหน้า"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setScrollOffset((v) => Math.max(v - 1, 0))}
            disabled={scrollOffset === 0}
            className="size-7 rounded-lg border border-zinc-200 bg-white hover:border-[--color-brand-300] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
            aria-label="ถัดไป"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Table — horizontal scroll on mobile */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="bg-white border-b-2 border-zinc-100">
              <th
                className="text-left px-3 sm:px-4 py-3 font-bold text-zinc-600 sticky left-0 bg-white z-10 min-w-[180px] sm:min-w-[220px]"
                style={{ borderRight: "1px solid var(--color-border)" }}
              >
                <span className="text-[10px] uppercase tracking-widest text-zinc-400">
                  ประเภทธุรกิจ
                </span>
              </th>
              {monthLabels.map((label, i) => {
                const isLatest = i === monthLabels.length - 1;
                return (
                  <th
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-3 font-bold text-right tabular-num min-w-[80px] sm:min-w-[100px]",
                      isLatest
                        ? "text-[--color-brand-700] bg-[--color-brand-50]/40"
                        : "text-zinc-500",
                    )}
                  >
                    {label}
                    {isLatest && (
                      <span className="block text-[9px] text-[--color-brand-600] font-normal mt-0.5">
                        เดือนนี้
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
              const latestVal = row.totals[row.totals.length - 1];
              return (
                <tr
                  key={row.businessType}
                  className={cn(
                    "border-b border-zinc-100 hover:bg-[--color-brand-50]/30 transition-colors",
                    rowIdx % 2 === 1 && "bg-zinc-50/40",
                  )}
                >
                  <td
                    className="px-3 sm:px-4 py-2.5 sticky left-0 bg-inherit z-10"
                    style={{ borderRight: "1px solid var(--color-border)" }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base shrink-0">
                        {cfg?.emoji ?? "📋"}
                      </span>
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
                    const showDiff = viewMode === "compare" && i > 0 && prev > 0;
                    const pct = showDiff
                      ? ((val - prev) / prev) * 100
                      : null;
                    return (
                      <td
                        key={i}
                        className={cn(
                          "px-2 sm:px-3 py-2.5 text-right tabular-num",
                          isLatest && "bg-[--color-brand-50]/30",
                          val === 0 && "text-zinc-300",
                        )}
                      >
                        <div
                          className={cn(
                            "font-semibold",
                            isLatest
                              ? "text-[--color-brand-800]"
                              : "text-zinc-700",
                          )}
                        >
                          {val > 0 ? formatBahtCompact(val) : "—"}
                        </div>
                        {pct !== null && (
                          <div
                            className={cn(
                              "text-[10px] font-bold tabular-num",
                              pct > 0
                                ? "text-[--color-leaf-700]"
                                : pct < 0
                                  ? "text-[--color-danger]"
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
              );
            })}

            {/* Footer row — totals */}
            <tr className="border-t-2 border-zinc-300 bg-[--color-brand-50]/30 font-bold">
              <td
                className="px-3 sm:px-4 py-3 sticky left-0 bg-[--color-brand-50] z-10"
                style={{ borderRight: "1px solid var(--color-border)" }}
              >
                <div className="text-[10px] uppercase tracking-widest text-[--color-brand-700] font-bold">
                  รวมทั้งหมด
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  ทุกประเภทธุรกิจ
                </div>
              </td>
              {monthlyTotals.map((total, i) => {
                const isLatest = i === monthlyTotals.length - 1;
                const pct = changePct[i];
                return (
                  <td
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-3 text-right tabular-num",
                      isLatest && "bg-[--color-brand-100]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "font-extrabold",
                        isLatest
                          ? "text-[--color-brand-800]"
                          : "text-zinc-800",
                      )}
                    >
                      {formatBahtCompact(total)}
                    </div>
                    {pct !== null && (
                      <div
                        className={cn(
                          "text-[10px] font-bold tabular-num inline-flex items-center gap-0.5",
                          pct > 0
                            ? "text-[--color-leaf-700]"
                            : pct < 0
                              ? "text-[--color-danger]"
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
        <span>เลื่อนซ้าย/ขวาเพื่อดูเดือนเก่า/ใหม่</span>
        <span>คลิกแถวเพื่อดูรายละเอียด · เร็ว ๆ นี้</span>
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border-2 border-zinc-200 bg-white p-0.5">
      <button
        type="button"
        onClick={() => onChange("compare")}
        className={cn(
          "px-3 h-7 text-xs font-bold rounded transition-colors",
          value === "compare"
            ? "bg-[--color-brand-600] text-white"
            : "text-zinc-600 hover:bg-zinc-50",
        )}
      >
        เทียบเดือน
      </button>
      <button
        type="button"
        onClick={() => onChange("ratio")}
        className={cn(
          "px-3 h-7 text-xs font-bold rounded transition-colors",
          value === "ratio"
            ? "bg-[--color-brand-600] text-white"
            : "text-zinc-600 hover:bg-zinc-50",
        )}
      >
        ยอดรวม
      </button>
    </div>
  );
}
