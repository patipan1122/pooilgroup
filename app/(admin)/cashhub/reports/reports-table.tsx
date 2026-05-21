"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Filter,
  X,
  LayoutGrid,
  Table as TableIcon,
} from "lucide-react";
import { ReportsFlatView } from "./reports-flat-view";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBahtCompact, bkkDate, bkkTime } from "@/lib/utils/format";
import type { BusinessGroupVm, ReportRowVm, MissingBranchVm } from "./page";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { cn } from "@/lib/utils/cn";
import { HeatmapCellModal } from "@/components/cashhub/heatmap-cell-modal";

interface BoardProps {
  groups: BusinessGroupVm[];
  filterStatus: string;
  filterType: string;
  filterDate: string;
  totalPending: number;
  totalMissing: number;
  showOnlyMissing: boolean;
}

const STATUS_CHIPS: { value: string; label: string; tone: string }[] = [
  { value: "", label: "ทั้งหมด", tone: "neutral" },
  { value: "submitted", label: "รออนุมัติ", tone: "warning" },
  { value: "approved", label: "อนุมัติแล้ว", tone: "success" },
  { value: "missing", label: "⚠️ ยังไม่ส่งวันนี้", tone: "danger" },
];

export function ReportsBoard({
  groups,
  filterStatus,
  filterType,
  filterDate,
  totalPending,
  totalMissing,
  showOnlyMissing,
}: BoardProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const [popup, setPopup] = useState<{
    branchId: string;
    branchCode: string;
    date: string;
  } | null>(null);
  const [openTypes, setOpenTypes] = useState<Set<string>>(() => {
    // Auto-expand groups that have pending or missing
    const expanded = new Set<string>();
    for (const g of groups) {
      if (g.pendingCount > 0 || g.missingCount > 0) expanded.add(g.type);
    }
    return expanded;
  });

  const allSubmittedRows = useMemo(
    () => groups.flatMap((g) => g.reports.filter((r) => r.status === "submitted")),
    [groups],
  );
  const allSubmittedSelected =
    allSubmittedRows.length > 0 &&
    allSubmittedRows.every((r) => selected.has(r.id));

  function toggleType(type: string) {
    setOpenTypes((cur) => {
      const next = new Set(cur);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }
  function expandAll() {
    setOpenTypes(new Set(groups.map((g) => g.type)));
  }
  function collapseAll() {
    setOpenTypes(new Set());
  }
  function toggleRow(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllSubmitted() {
    if (allSubmittedSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSubmittedRows.map((r) => r.id)));
    }
  }
  function bulkApprove() {
    if (selected.size === 0) return;
    const reportIds = Array.from(selected);
    startTransition(async () => {
      const res = await fetch("/api/cashhub/approve-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "อนุมัติไม่ได้");
        return;
      }
      toast.success(`อนุมัติ ${json.approved} รายงาน`, {
        description:
          json.skipped > 0
            ? `ข้าม ${json.skipped} (ไม่มีสิทธิ์/อนุมัติแล้ว)`
            : "",
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  // Build URL helper for filter chips
  function chipHref(patch: Partial<{ status: string; type: string; date: string }>) {
    const params = new URLSearchParams();
    const next = {
      status: filterStatus,
      type: filterType,
      date: filterDate,
      ...patch,
    };
    if (next.status) params.set("status", next.status);
    if (next.type) params.set("type", next.type);
    if (next.date) params.set("date", next.date);
    const q = params.toString();
    return q ? `/cashhub/reports?${q}` : "/cashhub/reports";
  }

  const hasAnyFilter = !!filterStatus || !!filterType || !!filterDate;

  return (
    <>
      {/* Filter bar — chips + date input */}
      <Card className="mb-4">
        <CardBody className="!py-3 !px-4">
          <div className="flex items-center gap-2 mb-2.5">
            <Filter className="size-3.5 text-zinc-400" />
            <span className="text-xs font-bold text-zinc-500">
              สถานะ
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {STATUS_CHIPS.map((c) => {
              const active = filterStatus === c.value;
              const isMissing = c.value === "missing";
              return (
                <Link
                  key={c.value || "all"}
                  href={chipHref({ status: c.value })}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2",
                    active
                      ? isMissing
                        ? "bg-rose-600 text-white border-rose-600"
                        : "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                      : "bg-white text-zinc-700 border-zinc-200 hover:border-[var(--color-brand-300)]",
                  )}
                >
                  {c.label}
                  {c.value === "submitted" && totalPending > 0 && (
                    <span
                      className={cn(
                        "tabular-num px-1.5 py-0.5 rounded-full text-[10px]",
                        active
                          ? "bg-white/20 text-white"
                          : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {totalPending}
                    </span>
                  )}
                  {isMissing && totalMissing > 0 && (
                    <span
                      className={cn(
                        "tabular-num px-1.5 py-0.5 rounded-full text-[10px]",
                        active
                          ? "bg-white/20 text-white"
                          : "bg-rose-100 text-rose-700",
                      )}
                    >
                      {totalMissing}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mb-2.5">
            <Filter className="size-3.5 text-zinc-400" />
            <span className="text-xs font-bold text-zinc-500">
              ประเภทธุรกิจ
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <Link
              href={chipHref({ type: "" })}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2",
                !filterType
                  ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                  : "bg-white text-zinc-700 border-zinc-200 hover:border-[var(--color-brand-300)]",
              )}
            >
              ทุกประเภท
            </Link>
            {Object.entries(BUSINESS_TYPES).map(([k, v]) => {
              const active = filterType === k;
              return (
                <Link
                  key={k}
                  href={chipHref({ type: k })}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2",
                    active
                      ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                      : "bg-white text-zinc-700 border-zinc-200 hover:border-[var(--color-brand-300)]",
                  )}
                >
                  <span>{v.emoji}</span>
                  <span>{v.label}</span>
                </Link>
              );
            })}
          </div>

          <form
            method="get"
            className="flex flex-wrap items-end gap-2 pt-2 border-t border-zinc-100"
          >
            {filterStatus && (
              <input type="hidden" name="status" value={filterStatus} />
            )}
            {filterType && <input type="hidden" name="type" value={filterType} />}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-zinc-500">
                วันที่
              </span>
              <input
                type="date"
                name="date"
                defaultValue={filterDate}
                className="h-9 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
              />
            </label>
            <button
              type="submit"
              className="h-9 px-4 rounded-xl bg-[var(--color-brand-600)] text-white font-semibold text-sm hover:bg-[var(--color-brand-700)]"
            >
              ใช้
            </button>
            {hasAnyFilter && (
              <Link
                href="/cashhub/reports"
                className="h-9 px-3 rounded-xl border border-zinc-200 text-zinc-600 font-semibold text-sm inline-flex items-center gap-1 hover:bg-zinc-50"
              >
                <X className="size-3.5" />
                ล้างตัวกรอง
              </Link>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="h-9 px-3 rounded-xl text-xs text-zinc-600 hover:text-[var(--color-brand-700)]"
              >
                ขยายทั้งหมด
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="h-9 px-3 rounded-xl text-xs text-zinc-600 hover:text-[var(--color-brand-700)]"
              >
                พับทั้งหมด
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Bulk approve bar */}
      {allSubmittedRows.length > 0 && (
        <Card className="mb-3 border-[var(--color-brand-200)]">
          <CardBody className="!py-3 !px-4 flex flex-wrap items-center gap-3 bg-[var(--color-brand-50)]/40">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold">
              <input
                type="checkbox"
                checked={allSubmittedSelected}
                onChange={toggleAllSubmitted}
                className="size-4 rounded border-zinc-300"
              />
              เลือกทั้งหมดที่รออนุมัติ ({allSubmittedRows.length})
            </label>
            <span className="text-xs text-zinc-500">
              {selected.size > 0
                ? `เลือก ${selected.size} รายการ`
                : "กดติ๊กเพื่อเลือกที่จะอนุมัติพร้อมกัน"}
            </span>
            <div className="ml-auto flex gap-2">
              {selected.size > 0 && (
                <Button
                  size="md"
                  onClick={bulkApprove}
                  loading={pending}
                  className="!bg-emerald-600 hover:!bg-emerald-700"
                >
                  <CheckCircle2 className="size-4" />
                  อนุมัติ {selected.size} รายงาน
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* View-mode tabs */}
      <div className="mb-3 inline-flex items-center gap-1 p-1 rounded-xl border-2 border-zinc-200 bg-white">
        <button
          type="button"
          onClick={() => setViewMode("board")}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
            viewMode === "board"
              ? "bg-[var(--color-brand-600)] text-white shadow-blue"
              : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          <LayoutGrid className="size-3.5" />
          กลุ่มตามธุรกิจ
        </button>
        <button
          type="button"
          onClick={() => setViewMode("table")}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
            viewMode === "table"
              ? "bg-[var(--color-brand-600)] text-white shadow-blue"
              : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          <TableIcon className="size-3.5" />
          ตาราง · Excel
        </button>
      </div>

      {viewMode === "table" && (
        <ReportsFlatView rows={groups.flatMap((g) => g.reports)} />
      )}

      {viewMode === "board" && (
      <>
      {/* Grouped board */}
      <div className="space-y-3">
        {groups.map((g) => {
          const isOpen = openTypes.has(g.type);
          const hasContent =
            g.reports.length > 0 || g.missing.length > 0;
          if (!hasContent && showOnlyMissing) return null;
          return (
            <Card key={g.type} className="overflow-hidden">
              <button
                type="button"
                onClick={() => toggleType(g.type)}
                className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-zinc-50 transition-colors text-left"
              >
                <div className="size-11 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-2xl shrink-0">
                  {g.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-zinc-900 text-base truncate">
                    {g.label}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 mt-0.5">
                    <span className="tabular-num">{g.branchCount} สาขา</span>
                    {g.approvedCount > 0 && (
                      <span className="text-emerald-700 font-semibold">
                        ✅ อนุมัติ {g.approvedCount}
                      </span>
                    )}
                    {g.pendingCount > 0 && (
                      <span className="text-amber-700 font-semibold">
                        ⏳ รออนุมัติ {g.pendingCount}
                      </span>
                    )}
                    {g.missingCount > 0 && (
                      <span className="text-rose-700 font-semibold">
                        ⚠️ ยังไม่ส่ง {g.missingCount}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-extrabold tabular-num font-display">
                    {formatBahtCompact(g.totalSales)}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-zinc-400 font-bold">
                    Approved
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown className="size-5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="size-5 text-zinc-400 shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="border-t border-zinc-100">
                  {/* Missing branches first — most actionable */}
                  {!showOnlyMissing && g.missing.length > 0 && (
                    <MissingList items={g.missing} />
                  )}
                  {showOnlyMissing && g.missing.length > 0 && (
                    <MissingList items={g.missing} />
                  )}

                  {!showOnlyMissing && g.reports.length > 0 && (
                    <ReportTable
                      rows={g.reports}
                      selected={selected}
                      onToggle={toggleRow}
                      onPopup={setPopup}
                    />
                  )}

                  {!showOnlyMissing &&
                    g.reports.length === 0 &&
                    g.missing.length === 0 && (
                      <div className="p-5 text-center text-xs text-zinc-500">
                        ไม่มีรายงานในตัวกรองนี้
                      </div>
                    )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      </>
      )}

      <div className="mt-4 flex justify-end">
        <a href="/api/cashhub/export">
          <Button variant="outline" size="md">
            Export CSV
          </Button>
        </a>
      </div>

      {/* Row popup — feedback_popup_first_drilldown.md */}
      {popup && (
        <HeatmapCellModal
          open={!!popup}
          onClose={() => setPopup(null)}
          branchId={popup.branchId}
          branchCode={popup.branchCode}
          date={popup.date}
          canApprove
        />
      )}
    </>
  );
}

function MissingList({ items }: { items: MissingBranchVm[] }) {
  return (
    <div className="bg-rose-50/40 border-b border-rose-100">
      <div className="px-4 sm:px-5 py-2 flex items-center gap-2">
        <AlertCircle className="size-4 text-rose-600" />
        <span className="text-xs font-bold text-rose-900">
          สาขาที่ยังไม่ส่งวันนี้ ({items.length})
        </span>
      </div>
      <ul className="divide-y divide-rose-100">
        {items.map((m) => (
          <li
            key={m.branch_id}
            className="px-4 sm:px-5 py-2.5 flex items-center gap-3"
          >
            <span className="text-lg shrink-0">{m.business_emoji}</span>
            <Link
              href={`/cashhub/branches/${m.branch_id}`}
              className="min-w-0 flex-1 hover:text-[var(--color-brand-700)]"
            >
              <div className="font-bold tabular-num text-sm truncate">
                {m.branch_code}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {m.branch_name}
              </div>
            </Link>
            <Badge tone={m.days_missing >= 3 ? "danger" : "warning"}>
              ขาด {m.days_missing} วัน
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportTable({
  rows,
  selected,
  onToggle,
  onPopup,
}: {
  rows: ReportRowVm[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onPopup: (p: { branchId: string; branchCode: string; date: string }) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50/40 text-xs font-bold text-zinc-500">
            <th className="w-9 p-3"></th>
            <th className="text-left p-3">สาขา</th>
            <th className="text-left p-3 hidden sm:table-cell">วันที่</th>
            <th className="text-right p-3">ยอด</th>
            <th className="text-left p-3 hidden md:table-cell">Reconcile</th>
            <th className="text-left p-3 hidden lg:table-cell">ส่งเมื่อ</th>
            <th className="text-right p-3">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSubmitted = r.status === "submitted";
            const isSelected = selected.has(r.id);
            const reconcileOk = Math.abs(r.reconcile_diff) < 0.01;
            return (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-zinc-50 hover:bg-[var(--color-brand-50)]/30 transition-colors",
                  isSelected && "bg-[var(--color-brand-50)]/40",
                )}
              >
                <td className="p-3 align-top">
                  {isSubmitted && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(r.id)}
                      aria-label={`เลือก ${r.branch_code}`}
                      className="size-4 rounded border-zinc-300 mt-1"
                    />
                  )}
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() =>
                      onPopup({
                        branchId: r.branch_id,
                        branchCode: r.branch_code,
                        date: r.report_date,
                      })
                    }
                    className="block text-left hover:text-[var(--color-brand-700)] w-full"
                  >
                    <div className="font-bold tabular-num text-sm">
                      {r.branch_code}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate sm:hidden">
                      {bkkDate(r.report_date)} · {r.shift_label}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate hidden sm:block">
                      {r.branch_name}
                    </div>
                  </button>
                </td>
                <td className="p-3 hidden sm:table-cell">
                  <div className="text-sm font-medium tabular-num">
                    {bkkDate(r.report_date)}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {r.shift_label}
                  </div>
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      onPopup({
                        branchId: r.branch_id,
                        branchCode: r.branch_code,
                        date: r.report_date,
                      })
                    }
                    className="font-bold tabular-num hover:text-[var(--color-brand-700)]"
                  >
                    {formatBahtCompact(r.total_sales)}
                  </button>
                </td>
                <td className="p-3 hidden md:table-cell">
                  {reconcileOk ? (
                    <Badge tone="success">
                      <CheckCircle2 className="size-3" />
                      ตรงพอดี
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      <AlertTriangle className="size-3" />
                      {r.reconcile_diff > 0 ? "ขาด" : "เกิน"} ฿
                      {Math.abs(r.reconcile_diff).toLocaleString("th-TH")}
                    </Badge>
                  )}
                </td>
                <td className="p-3 hidden lg:table-cell">
                  <span className="text-xs text-zinc-500 tabular-num">
                    {r.submitted_at ? bkkTime(r.submitted_at) : "—"}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <Badge tone={r.status_tone}>{r.status_label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
