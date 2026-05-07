"use client";

// Notes inbox grouped by ประเภทธุรกิจ — popup-on-row-click
// feedback_filter_pattern_biztype_first.md · feedback_popup_first_drilldown.md

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, MessageSquare } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { formatBahtCompact, bkkDate } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { HeatmapCellModal } from "@/components/cashhub/heatmap-cell-modal";

export interface NoteListRow {
  id: string;
  branch_id: string;
  branch_code: string;
  business_type: string;
  report_date: string;
  notes: string;
  total_sales: number;
}

interface Props {
  rows: NoteListRow[];
  days: number;
  canApprove: boolean;
}

export function NotesGrouped({ rows, days, canApprove }: Props) {
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
  const [popup, setPopup] = useState<{
    branchId: string;
    branchCode: string;
    date: string;
  } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, NoteListRow[]>();
    for (const r of rows) {
      const arr = map.get(r.business_type) ?? [];
      arr.push(r);
      map.set(r.business_type, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  const allOpen =
    groups.length > 0 && groups.every(([t]) => openTypes[t] !== false);

  function expandAll() {
    setOpenTypes(Object.fromEntries(groups.map(([t]) => [t, true])));
  }
  function collapseAll() {
    setOpenTypes(Object.fromEntries(groups.map(([t]) => [t, false])));
  }
  function toggleType(t: string) {
    setOpenTypes((o) => ({ ...o, [t]: !(o[t] ?? true) }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{rows.length} ข้อความ</CardTitle>
        <div className="flex items-center gap-3">
          <Badge tone="brand">{days} วันล่าสุด</Badge>
          {groups.length > 1 && (
            <button
              type="button"
              onClick={allOpen ? collapseAll : expandAll}
              className="text-xs font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)]"
            >
              {allOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
            </button>
          )}
        </div>
      </CardHeader>
      <CardBody className="!p-0">
        {groups.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">
            <MessageSquare className="size-6 mx-auto mb-2 text-zinc-400" />
            ยังไม่มีโน้ต
          </div>
        ) : (
          <ul className="divide-y-2 divide-zinc-100">
            {groups.map(([type, list]) => {
              const cfg = BUSINESS_TYPES[type];
              const isOpen = openTypes[type] ?? true;
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => toggleType(type)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
                  >
                    <span className="text-xl shrink-0">
                      {cfg?.emoji ?? "📋"}
                    </span>
                    <div className="text-left flex-1 min-w-0">
                      <div className="font-bold text-sm">
                        {cfg?.label ?? type}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {list.length} ข้อความ
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
                    <ul className="border-t border-zinc-100 bg-zinc-50/40 divide-y divide-zinc-100">
                      {list.map((r) => (
                        <li key={r.id} className="px-4 py-3 hover:bg-white">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Link
                              href={`/cashhub/branches/${r.branch_id}`}
                              className="font-bold tabular-num text-sm hover:text-[var(--color-brand-700)]"
                            >
                              {r.branch_code}
                            </Link>
                            <button
                              type="button"
                              onClick={() =>
                                setPopup({
                                  branchId: r.branch_id,
                                  branchCode: r.branch_code,
                                  date: r.report_date,
                                })
                              }
                            >
                              <Badge tone="neutral">
                                {bkkDate(r.report_date)}
                              </Badge>
                            </button>
                            <Badge tone="brand">
                              {formatBahtCompact(r.total_sales)}
                            </Badge>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-800">
                            {r.notes}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      {/* Row popup */}
      {popup && (
        <HeatmapCellModal
          open={!!popup}
          onClose={() => setPopup(null)}
          branchId={popup.branchId}
          branchCode={popup.branchCode}
          date={popup.date}
          canApprove={canApprove}
        />
      )}
    </Card>
  );
}
