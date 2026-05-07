"use client";

// Shortages list grouped by ประเภทธุรกิจ — popup-on-row-click
// feedback_filter_pattern_biztype_first.md · feedback_popup_first_drilldown.md

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, AlertCircle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { formatBaht, bkkDate } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { HeatmapCellModal } from "@/components/cashhub/heatmap-cell-modal";

export interface ShortageRow {
  id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  business_type: string;
  report_date: string;
  amount: number;
  person_name: string | null;
  note: string | null;
}

interface Props {
  rows: ShortageRow[];
  canApprove: boolean;
}

export function ShortagesGrouped({ rows, canApprove }: Props) {
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
  const [popup, setPopup] = useState<{
    branchId: string;
    branchCode: string;
    date: string;
  } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ShortageRow[]>();
    for (const r of rows) {
      const arr = map.get(r.business_type) ?? [];
      arr.push(r);
      map.set(r.business_type, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) =>
        b[1].reduce((s, r) => s + r.amount, 0) -
        a[1].reduce((s, r) => s + r.amount, 0),
    );
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
        <CardTitle>รายการเงินขาด · จัดกลุ่มตามประเภทธุรกิจ</CardTitle>
        {groups.length > 1 && (
          <button
            type="button"
            onClick={allOpen ? collapseAll : expandAll}
            className="text-xs font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)]"
          >
            {allOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
          </button>
        )}
      </CardHeader>
      <CardBody className="!p-0">
        {groups.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">
            <AlertCircle className="size-6 mx-auto mb-2 text-zinc-400" />
            ไม่มีรายการในตัวกรองนี้
          </div>
        ) : (
          <ul className="divide-y-2 divide-zinc-100">
            {groups.map(([type, list]) => {
              const cfg = BUSINESS_TYPES[type];
              const isOpen = openTypes[type] ?? true;
              const total = list.reduce((s, r) => s + r.amount, 0);
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
                        {list.length} ครั้ง
                      </div>
                    </div>
                    <div className="text-sm font-extrabold tabular-num text-red-700 shrink-0">
                      {formatBaht(total)}
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
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setPopup({
                                  branchId: r.branch_id,
                                  branchCode: r.branch_code,
                                  date: r.report_date,
                                })
                              }
                              className="text-sm font-bold tabular-num text-zinc-900 hover:text-[var(--color-brand-700)]"
                            >
                              {bkkDate(r.report_date)}
                            </button>
                            <div className="text-sm font-extrabold tabular-num text-red-700">
                              {formatBaht(r.amount)}
                            </div>
                          </div>
                          <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-zinc-500 mt-1">
                            <Link
                              href={`/cashhub/branches/${r.branch_id}`}
                              className="hover:text-[var(--color-brand-700)] font-semibold"
                            >
                              {r.branch_code}
                            </Link>
                            <span>·</span>
                            <span>{r.person_name || "รวมร้าน"}</span>
                            {r.note && (
                              <>
                                <span>·</span>
                                <span className="italic">"{r.note}"</span>
                              </>
                            )}
                          </div>
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
