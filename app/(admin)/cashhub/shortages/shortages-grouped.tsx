"use client";

// Shortages list — group by สาขา / ประเภทธุรกิจ / พนักงาน
// D-020 (2026-05-20): default group = สาขา · CEO อยากเห็น "สาขานี้มีใครขาดวันไหนบ้าง"
// feedback_filter_pattern_biztype_first.md · feedback_popup_first_drilldown.md

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, AlertCircle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
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

export type ShortageGroupBy = "branch" | "business_type" | "person";

interface Props {
  rows: ShortageRow[];
  canApprove: boolean;
  groupBy?: ShortageGroupBy;
}

interface GroupHeader {
  key: string;
  label: string;
  sublabel?: string;
  icon: string;
}

export function ShortagesGrouped({
  rows,
  canApprove,
  groupBy = "branch",
}: Props) {
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const [popup, setPopup] = useState<{
    branchId: string;
    branchCode: string;
    date: string;
  } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { header: GroupHeader; list: ShortageRow[] }>();
    for (const r of rows) {
      let key: string;
      let header: GroupHeader;
      if (groupBy === "branch") {
        key = r.branch_id;
        header = {
          key,
          label: r.branch_name || r.branch_code,
          sublabel: r.branch_code,
          icon: BUSINESS_TYPES[r.business_type]?.emoji ?? "🏪",
        };
      } else if (groupBy === "person") {
        key = r.person_name || "(ไม่ระบุชื่อ)";
        header = {
          key,
          label: key,
          icon: "👤",
        };
      } else {
        key = r.business_type;
        const cfg = BUSINESS_TYPES[r.business_type];
        header = {
          key,
          label: cfg?.label ?? r.business_type,
          icon: cfg?.emoji ?? "📋",
        };
      }
      const cur = map.get(key) ?? { header, list: [] };
      cur.list.push(r);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        b.list.reduce((s, r) => s + r.amount, 0) -
        a.list.reduce((s, r) => s + r.amount, 0),
    );
  }, [rows, groupBy]);

  const allOpen =
    groups.length > 0 &&
    groups.every((g) => openKeys[g.header.key] !== false);

  function expandAll() {
    setOpenKeys(Object.fromEntries(groups.map((g) => [g.header.key, true])));
  }
  function collapseAll() {
    setOpenKeys(Object.fromEntries(groups.map((g) => [g.header.key, false])));
  }
  function toggleKey(k: string) {
    setOpenKeys((o) => ({ ...o, [k]: !(o[k] ?? true) }));
  }

  const groupTitle =
    groupBy === "branch"
      ? "รายการเงินขาด · จัดกลุ่มตามสาขา"
      : groupBy === "person"
        ? "รายการเงินขาด · จัดกลุ่มตามพนักงาน"
        : "รายการเงินขาด · จัดกลุ่มตามประเภทธุรกิจ";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{groupTitle}</CardTitle>
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
            {groups.map(({ header, list }) => {
              const isOpen = openKeys[header.key] ?? true;
              const total = list.reduce((s, r) => s + r.amount, 0);
              return (
                <li key={header.key}>
                  <button
                    type="button"
                    onClick={() => toggleKey(header.key)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
                  >
                    <span className="text-xl shrink-0">{header.icon}</span>
                    <div className="text-left flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">
                        {header.label}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {header.sublabel
                          ? `${header.sublabel} · ${list.length} ครั้ง`
                          : `${list.length} ครั้ง`}
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
                      {list
                        .slice()
                        .sort((a, b) =>
                          b.report_date.localeCompare(a.report_date),
                        )
                        .map((r) => (
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
                                📅 {bkkDate(r.report_date)}
                              </button>
                              <div className="text-sm font-extrabold tabular-num text-red-700">
                                {formatBaht(r.amount)}
                              </div>
                            </div>
                            <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-zinc-500 mt-1">
                              {groupBy !== "branch" && (
                                <>
                                  <Link
                                    href={`/cashhub/branches/${r.branch_id}`}
                                    className="hover:text-[var(--color-brand-700)] font-semibold"
                                  >
                                    🏪 {r.branch_code}
                                  </Link>
                                  <span>·</span>
                                </>
                              )}
                              {groupBy !== "person" && (
                                <>
                                  <span className="font-semibold text-zinc-700">
                                    👤 {r.person_name || "(ไม่ระบุชื่อ)"}
                                  </span>
                                  {r.note && <span>·</span>}
                                </>
                              )}
                              {r.note && (
                                <span className="italic">
                                  &ldquo;{r.note}&rdquo;
                                </span>
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
