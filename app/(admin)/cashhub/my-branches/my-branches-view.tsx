"use client";

// Branch-manager landing — popup-first + grouped by ประเภทธุรกิจ
// feedback_popup_first_drilldown.md · feedback_filter_pattern_biztype_first.md

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import {
  ClipboardCheck,
  ChevronRight,
  AlertCircle,
  ScrollText,
  CheckCircle2,
  CircleDashed,
  XCircle,
  Clock,
  Search,
  X,
} from "lucide-react";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { cn } from "@/lib/utils/cn";
import { HeatmapCellModal } from "@/components/cashhub/heatmap-cell-modal";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

interface Props {
  branches: BranchRow[];
  /** branch_id → date (YYYY-MM-DD) → status */
  matrix: Record<string, Record<string, string>>;
  days: string[]; // newest → oldest
  today: string;
  canApprove: boolean;
}

export function MyBranchesView({
  branches,
  matrix,
  days,
  today,
  canApprove,
}: Props) {
  const [query, setQuery] = useState("");
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<{
    branchId: string;
    branchCode: string;
    date: string;
  } | null>(null);

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

  const effectiveOpen = useMemo(() => {
    if (query.trim()) return Object.fromEntries(groups.map(([t]) => [t, true]));
    // Default: open all when there are ≤ 3 groups
    if (groups.length <= 3 && Object.keys(openTypes).length === 0) {
      return Object.fromEntries(groups.map(([t]) => [t, true]));
    }
    return openTypes;
  }, [groups, openTypes, query]);

  const allOpen = groups.length > 0 && groups.every(([t]) => effectiveOpen[t]);

  // Today summary
  const todayDone = branches.filter((b) => {
    const s = matrix[b.id]?.[today];
    return s === "approved" || s === "submitted";
  }).length;
  const todayMissing = branches.length - todayDone;

  return (
    <>
      {/* TODAY — same pattern, grouped */}
      <Section
        number="01"
        label="TODAY"
        title={`วันนี้ ${todayDone}/${branches.length} สาขา กรอกแล้ว`}
        description="กดสาขาที่ยังไม่กรอกเพื่อกรอกได้เลย"
        className="mb-10 animate-fade-up"
      >
        {/* Toolbar */}
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
              onClick={() =>
                allOpen
                  ? setOpenTypes({})
                  : setOpenTypes(
                      Object.fromEntries(groups.map(([t]) => [t, true])),
                    )
              }
              className="text-sm font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-xl border-2 border-[var(--color-brand-200)] bg-white hover:bg-[var(--color-brand-50)]"
            >
              {allOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {groups.map(([type, list]) => {
            const cfg = BUSINESS_TYPES[type];
            const isOpen = !!effectiveOpen[type];
            const doneCount = list.filter((b) => {
              const s = matrix[b.id]?.[today];
              return s === "approved" || s === "submitted";
            }).length;
            return (
              <div
                key={type}
                className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenTypes((o) => ({ ...o, [type]: !o[type] }))
                  }
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
                >
                  <span className="text-xl shrink-0">{cfg?.emoji ?? "📋"}</span>
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-bold text-sm">
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
                  <div className="border-t-2 border-zinc-100 bg-zinc-50/40 p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {list.map((b) => {
                      const status = matrix[b.id]?.[today];
                      const isDone =
                        status === "approved" || status === "submitted";
                      return (
                        <Link
                          key={b.id}
                          href={`/liff/report/${b.id}`}
                          className={cn(
                            "group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-all",
                            isDone
                              ? "bg-[var(--color-leaf-50)]/60 border border-[var(--color-leaf-200)] hover:bg-[var(--color-leaf-50)]"
                              : "bg-white border border-zinc-200 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/30",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold tabular-num text-sm">
                                {b.code}
                              </span>
                              {isDone && (
                                <Badge tone="success">
                                  {status === "approved"
                                    ? "✓ อนุมัติ"
                                    : "✓ ส่งแล้ว"}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-zinc-600 truncate mt-0.5">
                              {b.name}
                            </div>
                          </div>
                          {!isDone && (
                            <span className="inline-flex items-center gap-1 px-3 h-8 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold group-hover:bg-[var(--color-brand-700)] shrink-0">
                              <ClipboardCheck className="size-3.5" />
                              กรอก
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {todayMissing > 0 && (
          <p className="text-xs text-zinc-500 mt-3">
            เหลือ <strong className="text-amber-700">{todayMissing}</strong>{" "}
            สาขาที่ยังไม่กรอกวันนี้
          </p>
        )}
      </Section>

      {/* HISTORY — heatmap, also grouped + popup on cell click */}
      <Section
        number="02"
        label="HISTORY"
        title={`${days.length} วันย้อนหลัง`}
        description="กดเซลล์เพื่อดูรายงาน · กดที่ชื่อสาขาเพื่อดูประวัติเต็ม"
        className="mb-10 animate-fade-up delay-100"
      >
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-3">
          <Badge tone="success">
            <CheckCircle2 className="size-3" /> อนุมัติ
          </Badge>
          <Badge tone="warning">
            <Clock className="size-3" /> รออนุมัติ
          </Badge>
          <Badge tone="danger">
            <XCircle className="size-3" /> ปฏิเสธ
          </Badge>
          <span className="inline-flex items-center gap-1">
            <CircleDashed className="size-3 text-zinc-400" /> ไม่กรอก
          </span>
        </div>

        {/* Single unified table — biz-type dividers inline */}
        <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-x-auto">
          <table className="text-xs min-w-full">
            <thead className="bg-zinc-50/50 sticky top-0 z-10">
              <tr className="border-b border-zinc-100">
                <th className="text-left p-2 sticky left-0 bg-zinc-50 z-20 whitespace-nowrap">
                  สาขา
                </th>
                {days.map((d) => {
                  const day = parseInt(d.slice(8, 10), 10);
                  return (
                    <th
                      key={d}
                      className={cn(
                        "p-1 text-center font-semibold tabular-num text-[10px] w-7",
                        d === today &&
                          "text-[var(--color-brand-700)] font-extrabold",
                      )}
                    >
                      {day}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map(([type, list]) => {
                const cfg = BUSINESS_TYPES[type];
                const isOpen = !!effectiveOpen[type];
                return (
                  <Fragment key={type}>
                    <tr className="bg-zinc-50/40 border-y-2 border-zinc-100">
                      <td
                        colSpan={days.length + 1}
                        className="sticky left-0 bg-zinc-50/40 p-0"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenTypes((o) => ({ ...o, [type]: !o[type] }))
                          }
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-100/60 transition-colors text-left"
                        >
                          <ChevronRight
                            className={cn(
                              "size-4 text-zinc-500 shrink-0 transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                          <span className="text-base shrink-0">
                            {cfg?.emoji ?? "📋"}
                          </span>
                          <span className="font-bold text-sm">
                            {cfg?.label ?? type}
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            · {list.length} สาขา
                          </span>
                        </button>
                      </td>
                    </tr>
                    {isOpen &&
                      list.map((b) => (
                        <tr key={b.id} className="border-b border-zinc-50">
                          <td className="p-2 sticky left-0 bg-white whitespace-nowrap font-medium">
                            <Link
                              href={`/cashhub/branches/${b.id}`}
                              className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-700)]"
                            >
                              <span className="tabular-num">{b.code}</span>
                            </Link>
                          </td>
                          {days.map((d) => {
                            const status = matrix[b.id]?.[d];
                            return (
                              <td key={d} className="p-0.5 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTarget({
                                      branchId: b.id,
                                      branchCode: b.code,
                                      date: d,
                                    })
                                  }
                                  className={cn(
                                    "size-5 mx-auto rounded-md flex items-center justify-center transition-transform hover:scale-110 cursor-pointer",
                                    cellColor(status),
                                  )}
                                  title={`${b.code} · ${d} · ${statusLabel(status)}`}
                                  aria-label={`${b.code} วันที่ ${d}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* QUICK ACCESS */}
      <Section
        number="03"
        label="QUICK ACCESS"
        title="ทางลัด"
        description="ดูเงินขาดของสาขาฉัน · โน้ตจาก Staff"
        className="animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/cashhub/shortages"
            className="group rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover-lift transition-all"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <AlertCircle className="size-5" />
              </div>
              <h3 className="font-bold font-display text-zinc-900">เงินขาด</h3>
            </div>
            <p className="text-sm text-zinc-600">
              ดูประวัติเงินขาดของสาขาฉัน · ระบุตัวคน · หมายเหตุ
            </p>
          </Link>
          <Link
            href="/cashhub/notes"
            className="group rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover-lift transition-all"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 rounded-xl bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center">
                <ScrollText className="size-5" />
              </div>
              <h3 className="font-bold font-display text-zinc-900">
                โน้ตจาก Staff
              </h3>
            </div>
            <p className="text-sm text-zinc-600">
              ข้อความที่พนักงานหน้าร้านแนบมาในใบรายงาน
            </p>
          </Link>
        </div>
      </Section>

      {/* Cell popup */}
      {target && (
        <HeatmapCellModal
          open={!!target}
          onClose={() => setTarget(null)}
          branchId={target.branchId}
          branchCode={target.branchCode}
          date={target.date}
          canFill
          canApprove={canApprove}
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
