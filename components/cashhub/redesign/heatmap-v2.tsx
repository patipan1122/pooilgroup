"use client";

// Heatmap V2 — 3-tab container matching Claude Design handoff
// MLMc2DZd7q-5cmIzvrh5hw (variant V2).
// Tabs: ตารางกรอกครบ · กระทบยอดแบงก์ · ไทม์ไลน์รายงาน

import { useMemo, useState, useRef, type KeyboardEvent } from "react";
import {
  CalendarDays,
  Banknote,
  ListChecks,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Flame,
} from "lucide-react";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { ReconcileTab } from "@/components/cashhub/redesign/reconcile-tab";
import { TimelineTab, type TimelineEntry } from "@/components/cashhub/redesign/timeline-tab";
import { HeatmapGrid } from "@/app/(admin)/cashhub/heatmap/heatmap-grid";
import type { ReconcileRow } from "@/lib/cashhub/bank-reconcile";

type Tab = "heatmap" | "reconcile" | "timeline";

interface HeatmapBranchRow {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

interface Props {
  branches: HeatmapBranchRow[];
  matrix: Record<string, Record<number, string>>;
  daysInMonth: number;
  todayDay: number;
  monthYm: string;
  monthLabelTh: string;
  daysElapsed: number;
  reportsTotalMonth: number;
  canFill: boolean;
  canApprove: boolean;
  reconcile: {
    rows: ReconcileRow[];
    summary: {
      matched: number;
      diff: number;
      noBank: number;
      missingFill: number;
      bankIncomeToday: number;
    };
  };
  timeline: TimelineEntry[];
}

function formatBahtCompact(n: number) {
  if (Math.abs(n) >= 1_000_000)
    return "฿" + (n / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  if (Math.abs(n) >= 1_000)
    return "฿" + Math.round(n / 1_000) + "K";
  return "฿" + Math.round(n).toLocaleString("en-US");
}

export function HeatmapV2View({
  branches,
  matrix,
  daysInMonth,
  todayDay,
  monthYm,
  monthLabelTh,
  daysElapsed,
  reportsTotalMonth,
  canFill,
  canApprove,
  reconcile,
  timeline,
}: Props) {
  const [tab, setTab] = useState<Tab>("reconcile");
  // Refs to each tab button so arrow-key navigation can focus the right one.
  // Required for ARIA tabs pattern (WAI-ARIA APG) — keyboard users expect
  // Left/Right (or Home/End) to move between tabs without leaving the tablist.
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    heatmap: null,
    reconcile: null,
    timeline: null,
  });

  const tabs: { id: Tab; label: string; Icon: typeof CalendarDays; count: string; badge?: boolean }[] = [
    {
      id: "heatmap",
      label: "ตารางกรอกครบ",
      Icon: CalendarDays,
      count: `${branches.length} × ${daysInMonth}`,
    },
    {
      id: "reconcile",
      label: "กระทบยอดแบงก์",
      Icon: Banknote,
      count: `${reconcile.summary.diff + reconcile.summary.noBank} ผิดปกติ`,
      badge: reconcile.summary.diff > 0,
    },
    {
      id: "timeline",
      label: "ไทม์ไลน์รายงาน",
      Icon: ListChecks,
      count: `${timeline.length}`,
    },
  ];

  return (
    <div className="min-h-full bg-[var(--ch-bg-2)]">
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Hero */}
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 lg:gap-6">
          <div>
            <SectionPill num="📅" label="Heatmap · Reconcile" />
            <div className="mt-2">
              <TwoToneTitle first="ครบ &" accent="กระทบยอด" size={40} />
            </div>
            <div className="text-sm text-[var(--ch-text-2)] mt-1.5 max-w-xl">
              ดูใครยังไม่กรอก + จับคู่ยอดที่กรอกกับเงินเข้าธนาคารในที่เดียว
            </div>
          </div>
          <div className="flex-1" />
          <div className="ch-card-v2 bg-white p-3 sm:p-4 flex gap-4 sm:gap-6 text-xs">
            <div>
              <div className="text-[11px] font-semibold text-[var(--ch-text-3)]">
                เงินเข้าวันนี้
              </div>
              <div className="ch-tnum text-lg sm:text-xl font-bold text-[var(--ch-ok)] mt-0.5">
                {formatBahtCompact(reconcile.summary.bankIncomeToday)}
              </div>
            </div>
            <div className="w-px bg-[var(--ch-border)]" />
            <div>
              <div className="text-[11px] font-semibold text-[var(--ch-text-3)]">
                จับคู่แล้ว
              </div>
              <div className="ch-tnum text-lg sm:text-xl font-bold text-[var(--ch-navy)] mt-0.5">
                {reconcile.summary.matched} /{" "}
                {reconcile.summary.matched +
                  reconcile.summary.diff +
                  reconcile.summary.noBank +
                  reconcile.summary.missingFill}
              </div>
            </div>
            <div className="w-px bg-[var(--ch-border)]" />
            <div>
              <div className="text-[11px] font-semibold text-[var(--ch-text-3)]">
                ผิดปกติ
              </div>
              <div className="ch-tnum text-lg sm:text-xl font-bold text-[var(--ch-danger)] mt-0.5">
                {reconcile.summary.diff}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs — WAI-ARIA tablist pattern (Left/Right/Home/End nav) */}
        <div
          role="tablist"
          aria-label="มุมมอง Heatmap"
          className="mt-5 flex gap-1 border-b border-[var(--ch-border)] overflow-x-auto ch-no-scroll"
        >
          {tabs.map((t, idx) => {
            const active = tab === t.id;
            const { Icon } = t;
            const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
              // Arrow keys move focus + activate next tab (automatic activation
              // is OK here — switching tabs is cheap, no destructive side effect).
              if (
                e.key !== "ArrowRight" &&
                e.key !== "ArrowLeft" &&
                e.key !== "Home" &&
                e.key !== "End"
              )
                return;
              e.preventDefault();
              let nextIdx = idx;
              if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
              else if (e.key === "ArrowLeft")
                nextIdx = (idx - 1 + tabs.length) % tabs.length;
              else if (e.key === "Home") nextIdx = 0;
              else if (e.key === "End") nextIdx = tabs.length - 1;
              const nextId = tabs[nextIdx]!.id;
              setTab(nextId);
              tabRefs.current[nextId]?.focus();
            };
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`heatmap-tab-${t.id}`}
                aria-selected={active}
                aria-controls={`heatmap-tabpanel-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={onKeyDown}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ch-brand)] focus-visible:ring-offset-1 rounded-sm"
                style={{
                  color: active ? "var(--ch-brand)" : "var(--ch-text-2)",
                  background: "transparent",
                  border: "none",
                  borderBottomWidth: 2,
                  borderBottomStyle: "solid",
                  borderBottomColor: active
                    ? "var(--ch-brand)"
                    : "transparent",
                  cursor: "pointer",
                }}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {t.label}
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: t.badge ? "var(--ch-danger)" : "var(--ch-bg-3)",
                    color: t.badge ? "white" : "var(--ch-text-3)",
                  }}
                  aria-hidden="true"
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        {tab === "heatmap" && (
          <div
            id="heatmap-tabpanel-heatmap"
            role="tabpanel"
            aria-labelledby="heatmap-tab-heatmap"
            className="mt-5"
          >
            <HeatmapStatStrip
              branches={branches}
              matrix={matrix}
              todayDay={todayDay}
            />
            <div className="ch-card-v2 bg-white p-3 sm:p-4 mt-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <SectionPill num="01" label="Matrix" />
                  <span className="text-xs text-[var(--ch-text-2)]">
                    <b>{branches.length} สาขา × {daysInMonth} วัน</b>
                  </span>
                </div>
                <div className="text-[11px] text-[var(--ch-text-3)]">
                  เดือน {monthLabelTh} · {daysElapsed}/{daysInMonth} วัน ·{" "}
                  {reportsTotalMonth} รายงาน
                </div>
              </div>
              <HeatmapGrid
                branches={branches}
                matrix={matrix}
                daysInMonth={daysInMonth}
                todayDay={todayDay}
                monthYm={monthYm}
                canFill={canFill}
                canApprove={canApprove}
              />
            </div>
          </div>
        )}
        {tab === "reconcile" && (
          <div
            id="heatmap-tabpanel-reconcile"
            role="tabpanel"
            aria-labelledby="heatmap-tab-reconcile"
          >
            <ReconcileTab rows={reconcile.rows} summary={reconcile.summary} />
          </div>
        )}
        {tab === "timeline" && (
          <div
            id="heatmap-tabpanel-timeline"
            role="tabpanel"
            aria-labelledby="heatmap-tab-timeline"
          >
            <TimelineTab entries={timeline} />
          </div>
        )}
      </div>
    </div>
  );
}

// 5-stat strip — design heatmap.jsx:128-148 · counts derived from matrix prop.
function HeatmapStatStrip({
  branches,
  matrix,
  todayDay,
}: {
  branches: HeatmapBranchRow[];
  matrix: Record<string, Record<number, string>>;
  todayDay: number;
}) {
  const stats = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    for (const b of branches) {
      const m = matrix[b.id] ?? {};
      for (const day of Object.keys(m)) {
        const s = m[Number(day)];
        if (s === "approved") approved++;
        else if (s === "submitted") pending++;
        else if (s === "rejected") rejected++;
      }
    }
    const missingToday = branches.filter((b) => !(matrix[b.id]?.[todayDay])).length;
    // Approx streak: last 21 days all have a status
    const streak21 = branches.filter((b) => {
      const m = matrix[b.id] ?? {};
      const look = Math.min(21, todayDay);
      for (let d = todayDay; d > todayDay - look; d--) {
        const s = m[d];
        if (s !== "approved" && s !== "submitted") return false;
      }
      return look > 0;
    }).length;
    return { approved, pending, rejected, missingToday, streak21 };
  }, [branches, matrix, todayDay]);

  const items: {
    Icon: typeof CheckCircle2;
    label: string;
    value: number;
    color: string;
    bg: string;
  }[] = [
    { Icon: CheckCircle2, label: "อนุมัติแล้ว", value: stats.approved, color: "var(--ch-brand)", bg: "var(--ch-brand-50)" },
    { Icon: Clock, label: "รออนุมัติ", value: stats.pending, color: "#a16207", bg: "var(--ch-pending-soft)" },
    { Icon: XCircle, label: "ปฏิเสธ", value: stats.rejected, color: "var(--ch-danger)", bg: "var(--ch-danger-soft)" },
    { Icon: AlertCircle, label: "ไม่กรอก (วันนี้)", value: stats.missingToday, color: "var(--ch-text-2)", bg: "var(--ch-bg-3)" },
    { Icon: Flame, label: "ติดต่อกัน ≥ 21 วัน", value: stats.streak21, color: "var(--ch-ok)", bg: "var(--ch-ok-soft)" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {items.map((s) => {
        const { Icon } = s;
        return (
          <div key={s.label} className="ch-card-v2 bg-white p-3">
            <div className="flex items-center gap-2">
              <span
                className="size-7 rounded-md grid place-items-center"
                style={{ background: s.bg, color: s.color }}
              >
                <Icon className="size-3.5" />
              </span>
              <div className="text-xs text-[var(--ch-text-2)] font-medium">
                {s.label}
              </div>
            </div>
            <div
              className="ch-tnum text-2xl font-bold mt-1.5"
              style={{ color: "var(--ch-navy)", letterSpacing: "-.02em" }}
            >
              {s.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
