// ExecutiveTable v2 — รายเดือน / รายวัน / รายปี + expand แต่ละแถวดูสาขา
//
// Brand DNA: ฟ้า + ขาว + เทา หลัก. เขียว/แดง = trend ↑/↓ binary.

"use client";

import { memo, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Calendar,
  CalendarDays,
  CalendarRange,
  ChevronsDownUp,
  ChevronsUpDown,
  BarChart3,
  CircleDollarSign,
  Hash,
  TrendingUpIcon,
  TrendingDownIcon,
  MinusIcon,
  SparklesIcon,
  XIcon,
  PlusIcon,
} from "lucide-react";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatBahtCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Sparkline } from "@/components/cashhub/charts";
import type { ExecutiveMatrix, Period } from "@/lib/cashhub/executive-matrix";

type HealthKind = "growing" | "steady" | "watch" | "new" | "silent";

// Inline HealthChip — design canvas dashboard.jsx:10-28 / health-badge-v2.tsx.
// Kept inline to avoid the cross-component dependency from a UI primitive
// that's only used inside this table (and keep ExecutiveTable self-contained).
function HealthChip({ kind, compact = false }: { kind: HealthKind; compact?: boolean }) {
  const map = {
    growing: { label: "เติบโต", bg: "var(--color-leaf-50)", fg: "var(--color-leaf-700)", Icon: TrendingUpIcon },
    steady: { label: "ทรงตัว", bg: "var(--color-zinc-50)", fg: "var(--color-zinc-600)", Icon: MinusIcon },
    watch: { label: "น่าห่วง", bg: "var(--color-danger-bg)", fg: "var(--color-danger)", Icon: TrendingDownIcon },
    new: { label: "เริ่มกรอก", bg: "var(--color-info-bg)", fg: "var(--color-info)", Icon: PlusIcon },
    silent: { label: "ยังไม่กรอก", bg: "#f1f5f9", fg: "#94a3b8", Icon: XIcon },
  } as const;
  const m = map[kind];
  const { Icon } = m;
  void SparklesIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold",
        compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]",
      )}
      style={{ background: m.bg, color: m.fg }}
    >
      <Icon className={compact ? "size-2.5" : "size-3"} strokeWidth={2} />
      {compact ? null : m.label}
    </span>
  );
}

type ViewMode = "baht" | "quantity" | "count";

const VIEW_MODE_STORAGE_KEY = "pool.dashboard.matrix.viewMode";

interface Props {
  data: ExecutiveMatrix;
}

/** Compact number formatter for quantities — 1.2K / 5.4M / raw */
function formatQtyCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  if (n >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Per–business-type display config for quantity mode. */
type QtyDisplay = {
  /** Primary metric (large, top line) */
  primary: { values: number[]; unit: string };
  /** Optional secondary metric (small, second line) */
  secondary?: { values: number[]; unit: string };
} | null;

function getQtyDisplay(
  businessType: string,
  qty1: number[],
  qty2: number[],
): QtyDisplay {
  switch (businessType) {
    case "fuel_station":
      return {
        primary: { values: qty1, unit: "ลิตร" },
        secondary: { values: qty2, unit: "คัน" },
      };
    case "lpg_station":
      return {
        primary: { values: qty1, unit: "ลิตร" },
        secondary: { values: qty2, unit: "คัน" },
      };
    case "lpg_retail":
      return { primary: { values: qty1, unit: "ถัง" } };
    case "bottling_plant":
      return { primary: { values: qty1, unit: "ถัง" } };
    case "hotel":
      return { primary: { values: qty1, unit: "ห้อง" } };
    case "ev_station":
      // CEO: kWh เป็นตัวหลัก · คัน/Session เป็น secondary
      return {
        primary: { values: qty2, unit: "kWh" },
        secondary: { values: qty1, unit: "คัน" },
      };
    case "cafe":
    case "cafe_punthai":
      return { primary: { values: qty1, unit: "แก้ว" } };
    case "massage_chair":
      return { primary: { values: qty1, unit: "ครั้ง" } };
    case "claw_machine":
      return { primary: { values: qty1, unit: "รอบ" } };
    case "training_center":
      return { primary: { values: qty1, unit: "ครั้ง" } };
    case "convenience_store":
      // 7-Eleven ยังไม่เก็บจำนวนบิล → แสดง "—"
      return null;
    default:
      return null;
  }
}

export function ExecutiveTable({ data }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("baht");

  // Hydrate viewMode from localStorage (client-only)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === "quantity" || saved === "baht" || saved === "count") setViewMode(saved);
    } catch {
      // localStorage may be unavailable (SSR / private mode) — ignore
    }
  }, []);

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }

  const isQty = viewMode === "quantity";

  const currentYear = new Date().getFullYear();
  // periodKeys for annual look like "2026-12", "2026-11", ... → use first to infer year
  const selectedYear =
    data.period === "annual" && data.periodKeys.length > 0
      ? Number(data.periodKeys[0]!.slice(0, 4))
      : currentYear;

  const allExpanded = expanded.size === data.rows.length;
  const noneExpanded = expanded.size === 0;

  function expandAll() {
    setExpanded(new Set(data.rows.map((r) => r.businessType)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  // Reverse arrays so OLDEST → NEWEST (left → right, like calendar).
  // Memoized on `data` only — expand/collapse + viewMode toggles no longer
  // re-clone the full N-branch × M-period nested array (was O(b × p) per click).
  const {
    periodLabels,
    periodTotals,
    periodReportedCounts,
    rowsByType,
    totalsChangePct,
  } = useMemo(() => {
    const periodLabels = [...data.periodLabels].reverse();
    const periodTotals = [...data.periodTotals].reverse();
    const periodReportedCounts = [...data.periodReportedCounts].reverse();
    const rowsByType = data.rows.map((r) => ({
      ...r,
      totals: [...r.totals].reverse(),
      qty1Totals: [...r.qty1Totals].reverse(),
      qty2Totals: [...r.qty2Totals].reverse(),
      reportedCounts: [...r.reportedCounts].reverse(),
      branches: r.branches.map((b) => ({
        ...b,
        totals: [...b.totals].reverse(),
        qty1Totals: b.qty1Totals ? [...b.qty1Totals].reverse() : undefined,
        qty2Totals: b.qty2Totals ? [...b.qty2Totals].reverse() : undefined,
      })),
    }));
    const totalsChangePct = periodTotals.map((cur, i) => {
      if (i === 0) return null;
      const prev = periodTotals[i - 1];
      if (!prev) return null;
      return ((cur - prev) / prev) * 100;
    });
    return {
      periodLabels,
      periodTotals,
      periodReportedCounts,
      rowsByType,
      totalsChangePct,
    };
  }, [data]);

  // Stable callbacks — required for React.memo on BusinessTypeRow to skip
  // re-renders of non-toggled rows when expand state changes.
  const toggleExpand = useCallback((bt: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(bt)) next.delete(bt);
      else next.add(bt);
      return next;
    });
  }, []);

  const navigateBranch = useCallback(
    (branchId: string) => {
      startTransition(() => router.push(`/branches/${branchId}`));
    },
    [router],
  );

  function setPeriod(p: Period) {
    startTransition(() => {
      const url = new URL(window.location.href);
      if (p === "monthly") {
        url.searchParams.delete("view");
        url.searchParams.delete("year");
      } else if (p === "daily") {
        url.searchParams.set("view", "daily");
        url.searchParams.delete("year");
      } else {
        // annual
        url.searchParams.set("view", "annual");
        url.searchParams.set("year", String(selectedYear));
      }
      router.push(url.pathname + url.search);
    });
  }

  function setYear(year: number) {
    startTransition(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "annual");
      url.searchParams.set("year", String(year));
      router.push(url.pathname + url.search);
    });
  }

  const isDaily = data.period === "daily";
  const isAnnual = data.period === "annual";

  // Year options: current ± 3 (typical SME look-back). Avoid full DB scan; OK for SME size.
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
      {/* Filter bar — left: period toggle · right: expand/collapse all */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 sm:px-5 py-3 border-b-2 border-zinc-100 bg-zinc-50/40">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-600 font-bold">
            ดูแบบ
          </span>
          <PeriodToggle current={data.period} onChange={setPeriod} />
          {isAnnual && (
            <select
              value={selectedYear}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="เลือกปี พ.ศ. ที่ต้องการดู"
              className="h-8 rounded-lg border-2 border-zinc-200 bg-white px-2 text-xs font-bold text-zinc-700 hover:border-[var(--color-brand-400)] focus:border-[var(--color-brand-500)] focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  พ.ศ. {y + 543} (ค.ศ. {y})
                </option>
              ))}
            </select>
          )}
          <ViewModeToggle current={viewMode} onChange={changeViewMode} />
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

      {/* Table — horizontal scroll. Thead is sticky-top so the date row stays
          visible while scrolling deep into branches. Top offset matches the
          admin header (h-14 / sm:h-16). z-tiers: corner cell (top+left) z-30,
          other thead cells z-20, body sticky-left cells z-10. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="bg-white border-b-2 border-zinc-100">
              <th
                className="text-left px-3 sm:px-4 py-3 font-bold text-zinc-600 sticky top-14 sm:top-16 left-0 bg-white z-30 min-w-[200px] sm:min-w-[240px]"
                style={{ borderRight: "1px solid var(--color-border)" }}
              >
                <span className="text-xs font-semibold text-zinc-500">
                  ประเภทธุรกิจ
                </span>
              </th>
              {periodLabels.map((label, i) => {
                const isLatest = i === periodLabels.length - 1;
                return (
                  <th
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-3 font-bold text-right tabular-num min-w-[80px] sm:min-w-[96px] sticky top-14 sm:top-16 z-20",
                      isLatest
                        ? "text-[var(--color-brand-700)] bg-[var(--color-brand-50)]"
                        : "text-zinc-500 bg-white",
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
              {/* Trend + Status columns — design dashboard.jsx:211-212 */}
              <th
                className="px-2 py-3 font-bold text-center text-zinc-500 sticky top-14 sm:top-16 z-20 bg-white min-w-[80px]"
              >
                <span className="text-xs">เทรนด์</span>
              </th>
              <th
                className="px-2 py-3 font-bold text-center text-zinc-500 sticky top-14 sm:top-16 z-20 bg-white min-w-[100px]"
              >
                <span className="text-xs">สถานะ</span>
              </th>
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
                  onToggle={toggleExpand}
                  rowIdx={rowIdx}
                  viewMode={viewMode}
                  onNavigateBranch={navigateBranch}
                />
              );
            })}

            {/* Footer row — totals (hidden in quantity mode: หน่วยต่าง type รวมไม่ได้) */}
            {!isQty && (
            <tr className="border-t-2 border-zinc-300 bg-[var(--color-brand-50)]/30 font-bold">
              <td
                className="px-3 sm:px-4 py-3 sticky left-0 bg-[var(--color-brand-50)] z-10"
                style={{ borderRight: "1px solid var(--color-border)" }}
              >
                <div className="text-xs font-bold text-[var(--color-brand-700)]">
                  รวมทั้งหมด
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  ทุกประเภทธุรกิจ
                </div>
              </td>
              {periodTotals.map((total, i) => {
                const isLatest = i === periodTotals.length - 1;
                const pct = totalsChangePct[i];
                const reported = periodReportedCounts[i];
                const incomplete = reported < data.totalBranchCount;
                const tooltip = incomplete
                  ? `กรอกแล้ว ${reported}/${data.totalBranchCount} สาขา · ขาด ${data.totalBranchCount - reported} สาขา`
                  : undefined;
                return (
                  <td
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-3 text-right tabular-num",
                      isLatest && "bg-[var(--color-brand-100)]/50",
                    )}
                  >
                    <div
                      title={tooltip}
                      className={cn(
                        "font-extrabold",
                        incomplete
                          ? "text-[var(--color-danger)] cursor-help"
                          : isLatest
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
              {/* Footer trend + status — overall sparkline of period totals + global health */}
              <td className="px-2 py-3 text-center bg-[var(--color-brand-100)]/30">
                {periodTotals.some((v) => v > 0) ? (
                  <Sparkline
                    data={periodTotals.map((value, idx) => ({
                      date: `p${idx}`,
                      value,
                    }))}
                    width={72}
                    height={22}
                    className="inline-block"
                  />
                ) : (
                  <span className="text-zinc-300">—</span>
                )}
              </td>
              <td className="px-2 py-3 text-center bg-[var(--color-brand-100)]/30">
                {(() => {
                  const fCur = periodTotals[periodTotals.length - 1] ?? 0;
                  const fPrev = periodTotals[periodTotals.length - 2] ?? 0;
                  let k: HealthKind = "silent";
                  if (fCur === 0 && fPrev === 0) k = "silent";
                  else if (fPrev === 0 && fCur > 0) k = "new";
                  else if (fPrev > 0) {
                    const p = ((fCur - fPrev) / fPrev) * 100;
                    k = p >= 15 ? "growing" : p <= -15 ? "watch" : "steady";
                  }
                  return <HealthChip kind={k} />;
                })()}
              </td>
            </tr>
            )}
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
const BusinessTypeRow = memo(function BusinessTypeRow({
  row,
  cfg,
  isExpanded,
  onToggle,
  rowIdx,
  viewMode,
  onNavigateBranch,
}: {
  row: {
    businessType: string;
    totals: number[];
    qty1Totals: number[];
    qty2Totals: number[];
    reportedCounts: number[];
    branchCount: number;
    branches: Array<{
      id: string;
      code: string;
      name: string;
      totals: number[];
      qty1Totals?: number[];
      qty2Totals?: number[];
    }>;
  };
  cfg: { emoji: string; label: string } | undefined;
  isExpanded: boolean;
  onToggle: (businessType: string) => void;
  rowIdx: number;
  viewMode: ViewMode;
  onNavigateBranch: (branchId: string) => void;
}) {
  const isQty = viewMode === "quantity";
  const isCount = viewMode === "count";
  const qtyDisplay = isQty
    ? getQtyDisplay(row.businessType, row.qty1Totals, row.qty2Totals)
    : null;
  // Stable click handler — would otherwise allocate per render, defeating memo.
  const handleToggle = () => onToggle(row.businessType);

  // Trend sparkline + health pill — drives the right-most cells per design canvas
  // dashboard.jsx:257-262. Computed from current viewMode's series.
  const sparkSeries = isQty
    ? (qtyDisplay?.primary.values ?? row.qty1Totals)
    : isCount
      ? row.reportedCounts
      : row.totals;
  const cur = sparkSeries[sparkSeries.length - 1] ?? 0;
  const prev = sparkSeries[sparkSeries.length - 2] ?? 0;
  const healthKind: HealthKind =
    cur === 0 && prev === 0
      ? "silent"
      : prev === 0 && cur > 0
        ? "new"
        : prev === 0
          ? "silent"
          : ((cur - prev) / prev) * 100 >= 15
            ? "growing"
            : ((cur - prev) / prev) * 100 <= -15
              ? "watch"
              : "steady";

  return (
    <>
      <tr
        className={cn(
          "border-b border-zinc-100 transition-colors cursor-pointer group/row focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] focus-within:ring-inset",
          rowIdx % 2 === 1 && !isExpanded && "bg-zinc-50/40",
          isExpanded
            ? "bg-[var(--color-brand-50)]/40"
            : "hover:bg-[var(--color-brand-50)]/30",
        )}
        // Keyboard accessibility: use a hidden focusable wrapper inside the
        // first cell (see <button> below) so screen-reader users get a real
        // expand control with role/aria-expanded. The row-level onClick stays
        // for mouse users who click anywhere on the row.
        onClick={handleToggle}
      >
        <td
          className={cn(
            "px-3 sm:px-4 py-2.5 sticky left-0 z-10 transition-colors",
            isExpanded
              ? "bg-[var(--color-brand-100)]"
              : rowIdx % 2 === 1
                ? "bg-zinc-50 group-hover/row:bg-[var(--color-brand-50)]"
                : "bg-white group-hover/row:bg-[var(--color-brand-50)]",
          )}
          style={{ borderRight: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "หุบ" : "ขยาย"} ${cfg?.label ?? row.businessType} (${row.branchCount} สาขา)`}
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
              className="inline-flex items-center justify-center size-5 -m-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] shrink-0"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 transition-transform",
                  isExpanded ? "rotate-0" : "-rotate-90",
                )}
              />
            </button>
            <span className="text-base shrink-0" aria-hidden="true">{cfg?.emoji ?? "📋"}</span>
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
          const reported = row.reportedCounts[i];
          const incomplete = reported < row.branchCount;
          const tooltip = incomplete
            ? `กรอกแล้ว ${reported}/${row.branchCount} สาขา · ขาด ${row.branchCount - reported} สาขา`
            : undefined;

          // ────── Count mode (# รายงาน) — show reported count vs total branches ──────
          if (isCount) {
            const countVal = reported ?? 0;
            const denom = row.branchCount;
            const prevCount = i > 0 ? (row.reportedCounts[i - 1] ?? 0) : 0;
            const showDiff = i > 0 && prevCount > 0;
            const pct = showDiff
              ? ((countVal - prevCount) / prevCount) * 100
              : null;
            return (
              <td
                key={i}
                className={cn(
                  "px-2 sm:px-3 py-2.5 text-right tabular-num",
                  isLatest && "bg-[var(--color-brand-50)]/30",
                )}
              >
                <div
                  className={cn(
                    "font-semibold",
                    countVal === 0
                      ? "text-zinc-400"
                      : isLatest
                        ? "text-[var(--color-brand-800)]"
                        : "text-zinc-700",
                  )}
                >
                  {countVal}
                  <span className="text-[10px] text-zinc-400 font-normal">
                    {" "}/ {denom}
                  </span>
                </div>
                {pct !== null && countVal > 0 && (
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
          }

          // ────── Quantity mode ──────
          if (isQty) {
            // No qty data for this business type → "—"
            if (!qtyDisplay) {
              return (
                <td
                  key={i}
                  className={cn(
                    "px-2 sm:px-3 py-2.5 text-right tabular-num",
                    isLatest && "bg-[var(--color-brand-50)]/30",
                  )}
                >
                  <div className="font-semibold text-zinc-400">—</div>
                </td>
              );
            }
            const primaryVal = qtyDisplay.primary.values[i] ?? 0;
            const primaryPrev = i > 0 ? (qtyDisplay.primary.values[i - 1] ?? 0) : 0;
            const showPct = i > 0 && primaryPrev > 0 && primaryVal > 0;
            const pct = showPct ? ((primaryVal - primaryPrev) / primaryPrev) * 100 : null;
            const secondaryVal = qtyDisplay.secondary?.values[i] ?? 0;

            return (
              <td
                key={i}
                title={tooltip}
                className={cn(
                  "px-2 sm:px-3 py-2.5 text-right tabular-num",
                  isLatest && "bg-[var(--color-brand-50)]/30",
                  primaryVal === 0 && "text-zinc-400",
                )}
              >
                <div
                  className={cn(
                    "font-semibold",
                    incomplete
                      ? "text-[var(--color-danger)] cursor-help"
                      : isLatest
                        ? "text-[var(--color-brand-800)]"
                        : "text-zinc-700",
                  )}
                >
                  {primaryVal > 0 ? (
                    <>
                      {formatQtyCompact(primaryVal)}{" "}
                      <span className="text-[10px] text-zinc-400 font-normal">
                        {qtyDisplay.primary.unit}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
                {qtyDisplay.secondary && secondaryVal > 0 && (
                  <div className="text-[10px] text-zinc-500 tabular-num mt-0.5">
                    {formatQtyCompact(secondaryVal)} {qtyDisplay.secondary.unit}
                  </div>
                )}
                {pct !== null && (
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
          }

          // ────── Baht (default) mode ──────
          const prev = i > 0 ? row.totals[i - 1] : 0;
          const showDiff = i > 0 && prev > 0;
          const pct = showDiff ? ((val - prev) / prev) * 100 : null;
          return (
            <td
              key={i}
              className={cn(
                "px-2 sm:px-3 py-2.5 text-right tabular-num",
                isLatest && "bg-[var(--color-brand-50)]/30",
                val === 0 && !incomplete && "text-zinc-400",
              )}
            >
              <div
                title={tooltip}
                className={cn(
                  "font-semibold",
                  incomplete
                    ? "text-[var(--color-danger)] cursor-help"
                    : isLatest
                      ? "text-[var(--color-brand-800)]"
                      : "text-zinc-700",
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
        {/* Trend column — sparkline of current viewMode series (design dashboard.jsx:257-259) */}
        <td className="px-2 py-2.5 text-center">
          {sparkSeries.some((v) => v > 0) ? (
            <Sparkline
              data={sparkSeries.map((value, idx) => ({
                date: `p${idx}`,
                value,
              }))}
              width={72}
              height={22}
              className="inline-block"
            />
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </td>
        {/* Status column — HealthBadge (design dashboard.jsx:260-262) */}
        <td className="px-2 py-2.5 text-center">
          <HealthChip kind={healthKind} />
        </td>
      </tr>

      {/* Expanded branch sub-rows — use Next router for SPA navigation */}
      {isExpanded &&
        row.branches.map((b, bIdx) => (
          <tr
            key={b.id}
            className={cn(
              "border-b border-zinc-100 bg-[var(--color-brand-50)]/20 hover:bg-[var(--color-brand-50)]/40 transition-colors group/branchrow focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] focus-within:ring-inset",
              bIdx === row.branches.length - 1 &&
                "border-b-2 border-[var(--color-brand-200)]",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateBranch(b.id);
            }}
            style={{ cursor: "pointer" }}
          >
            <td
              className="px-3 sm:px-4 py-2 sticky left-0 z-10 bg-[var(--color-brand-50)] group-hover/branchrow:bg-[var(--color-brand-100)] transition-colors"
              style={{ borderRight: "1px solid var(--color-border)" }}
            >
              <div className="flex items-center gap-2 min-w-0 pl-7">
                <span className="text-zinc-300 text-sm" aria-hidden="true">└</span>
                <div className="min-w-0">
                  {/* Real focusable control for keyboard users — visually
                      identical to a text label but Enter/Space activates
                      the same navigation that mouse click does. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateBranch(b.id);
                    }}
                    className="text-left text-xs font-medium text-zinc-700 truncate tabular-num hover:text-[var(--color-brand-700)] focus-visible:outline-none focus-visible:underline rounded-sm"
                    aria-label={`เปิดสาขา ${b.code} ${b.name}`}
                  >
                    {b.code}
                  </button>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {b.name}
                  </div>
                </div>
              </div>
            </td>
            {b.totals.map((val, i) => {
              const isLatest = i === b.totals.length - 1;

              // ────── Quantity mode for sub-rows ──────
              if (isQty) {
                if (!qtyDisplay) {
                  return (
                    <td
                      key={i}
                      className={cn(
                        "px-2 sm:px-3 py-2 text-right tabular-num text-xs",
                        isLatest && "bg-[var(--color-brand-50)]/40",
                      )}
                    >
                      <span className="text-zinc-300">—</span>
                    </td>
                  );
                }
                // EV: kWh (qty2) เป็น primary · คัน (qty1) เป็น secondary — swap.
                // ประเภทอื่น: qty1 = primary · qty2 = secondary
                const useQty2AsPrimary = row.businessType === "ev_station";
                const pVal = useQty2AsPrimary
                  ? (b.qty2Totals?.[i] ?? 0)
                  : (b.qty1Totals?.[i] ?? 0);
                const sVal = useQty2AsPrimary
                  ? (b.qty1Totals?.[i] ?? 0)
                  : (b.qty2Totals?.[i] ?? 0);
                const missing = pVal === 0;
                return (
                  <td
                    key={i}
                    className={cn(
                      "px-2 sm:px-3 py-2 text-right tabular-num text-xs",
                      isLatest && "bg-[var(--color-brand-50)]/40",
                    )}
                  >
                    <span
                      className={cn(
                        missing
                          ? "text-zinc-300"
                          : isLatest
                            ? "text-[var(--color-brand-700)] font-semibold"
                            : "text-zinc-600",
                      )}
                    >
                      {missing
                        ? "—"
                        : `${formatQtyCompact(pVal)} ${qtyDisplay.primary.unit}`}
                    </span>
                    {qtyDisplay.secondary && sVal > 0 && (
                      <div className="text-[10px] text-zinc-400 tabular-num">
                        {formatQtyCompact(sVal)} {qtyDisplay.secondary.unit}
                      </div>
                    )}
                  </td>
                );
              }

              // ────── Baht mode (default) for sub-rows ──────
              const missing = val === 0;
              return (
                <td
                  key={i}
                  className={cn(
                    "px-2 sm:px-3 py-2 text-right tabular-num text-xs",
                    isLatest && "bg-[var(--color-brand-50)]/40",
                  )}
                >
                  <span
                    title={missing ? "ยังไม่กรอกยอด" : undefined}
                    className={cn(
                      missing
                        ? "text-[var(--color-danger)] font-bold cursor-help"
                        : isLatest
                          ? "text-[var(--color-brand-700)] font-semibold"
                          : "text-zinc-600",
                    )}
                  >
                    {missing ? "—" : formatBahtCompact(val)}
                  </span>
                </td>
              );
            })}
            {/* Sub-row trend + status — show per-branch sparkline */}
            <td className="px-2 py-2 text-center">
              {b.totals.some((v) => v > 0) ? (
                <Sparkline
                  data={b.totals.map((value, idx) => ({
                    date: `p${idx}`,
                    value,
                  }))}
                  width={64}
                  height={18}
                  className="inline-block opacity-70"
                />
              ) : (
                <span className="text-zinc-300">—</span>
              )}
            </td>
            <td className="px-2 py-2 text-center">
              {(() => {
                const sCur = b.totals[b.totals.length - 1] ?? 0;
                const sPrev = b.totals[b.totals.length - 2] ?? 0;
                let k: HealthKind = "silent";
                if (sCur === 0 && sPrev === 0) k = "silent";
                else if (sPrev === 0 && sCur > 0) k = "new";
                else if (sPrev > 0) {
                  const p = ((sCur - sPrev) / sPrev) * 100;
                  k = p >= 15 ? "growing" : p <= -15 ? "watch" : "steady";
                }
                return <HealthChip kind={k} compact />;
              })()}
            </td>
          </tr>
        ))}
    </>
  );
});

/* ============================================================
   Period toggle (รายเดือน / รายวัน / รายปี)
   ============================================================ */
function PeriodToggle({
  current,
  onChange,
}: {
  current: Period;
  onChange: (p: Period) => void;
}) {
  const btn = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 px-3 h-8 text-xs font-bold rounded transition-colors",
      active
        ? "bg-[var(--color-brand-600)] text-white"
        : "text-zinc-600 hover:bg-zinc-50",
    );
  return (
    <div className="inline-flex rounded-lg border-2 border-zinc-200 bg-white p-0.5">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={btn(current === "monthly")}
      >
        <Calendar className="size-3.5" />
        รายเดือน
      </button>
      <button
        type="button"
        onClick={() => onChange("daily")}
        className={btn(current === "daily")}
      >
        <CalendarDays className="size-3.5" />
        รายวัน
      </button>
      <button
        type="button"
        onClick={() => onChange("annual")}
        className={btn(current === "annual")}
      >
        <CalendarRange className="size-3.5" />
        รายปี
      </button>
    </div>
  );
}

/* ============================================================
   View mode toggle (฿ ยอดขาย / 📊 จำนวน)
   ============================================================ */
function ViewModeToggle({
  current,
  onChange,
}: {
  current: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const btn = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 px-3 h-8 text-xs font-bold rounded transition-colors",
      active
        ? "bg-[var(--color-brand-600)] text-white"
        : "text-zinc-600 hover:bg-zinc-50",
    );
  return (
    <div className="inline-flex rounded-lg border-2 border-zinc-200 bg-white p-0.5">
      <button
        type="button"
        onClick={() => onChange("baht")}
        className={btn(current === "baht")}
        aria-label="แสดงเป็นยอดขาย (บาท)"
      >
        <CircleDollarSign className="size-3.5" />
        ยอดขาย
      </button>
      <button
        type="button"
        onClick={() => onChange("quantity")}
        className={btn(current === "quantity")}
        aria-label="แสดงเป็นจำนวน (ลิตร/แก้ว/คัน ตามประเภทธุรกิจ)"
      >
        <BarChart3 className="size-3.5" />
        จำนวน
      </button>
      <button
        type="button"
        onClick={() => onChange("count")}
        className={btn(current === "count")}
        aria-label="แสดงเป็นจำนวนรายงาน"
      >
        <Hash className="size-3.5" />
        # รายงาน
      </button>
    </div>
  );
}
