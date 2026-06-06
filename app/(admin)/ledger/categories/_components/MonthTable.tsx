// Month-by-month expandable table for the category ledger book.
//
// Each row = one month (เดือน | ยอดรวม | จำนวนใบ). Tap a month → expand to its
// individual receipts (docCode · vendor · branch · total) — the "เปิดเล่ม" feel.
// Mobile-first: a real <table> on >=sm, stacked cards on phones would lose the
// columnar scan, so we keep a compact 3-column grid that reads fine at 360px.
//
// Client component ONLY for the expand/collapse toggle — all data is already
// computed server-side (categoryLedger). No fetch, no server round-trip on tap.
"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { CategoryLedgerMonth } from "@/lib/ledger/category-ledger";

function baht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
function monthLabel(period: string): string {
  if (period === "ไม่ระบุเดือน") return period;
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${TH_MONTHS[m - 1] ?? period} ${y + 543}`;
}

/** Date YYYY-MM-DD → "6 มิ.ย." (day + short month). */
const TH_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function dayLabel(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-").map(Number);
  if (!m || !day) return d;
  return `${day} ${TH_SHORT[m - 1] ?? ""}`;
}

export function MonthTable({
  months,
  baseParams,
  showBranch,
}: {
  months: CategoryLedgerMonth[];
  /** Preserved scope params (company/branch) for receipt deep-links. */
  baseParams: string;
  /** Show the per-row branch column (true on the whole-company axis). */
  showBranch: boolean;
}) {
  // First (latest) month expanded by default — the "open the book" landing.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(months.length > 0 ? [months[0].period] : []),
  );

  if (months.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-12 text-center">
        <p className="text-sm font-medium text-zinc-600">ยังไม่มีค่าใช้จ่ายในหมวดนี้</p>
        <p className="mt-1 text-xs text-zinc-400">
          พอยืนยันใบเสร็จในหมวดนี้แล้ว ประวัติรายเดือนจะขึ้นที่นี่
        </p>
      </div>
    );
  }

  const toggle = (period: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      {/* header */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2.5 text-xs font-semibold text-zinc-500">
        <span>เดือน</span>
        <span className="text-right">ยอดรวม</span>
        <span className="w-12 text-right">ใบ</span>
      </div>

      <ul className="divide-y divide-zinc-100">
        {months.map((mo) => {
          const isOpen = open.has(mo.period);
          return (
            <li key={mo.period}>
              <button
                type="button"
                onClick={() => toggle(mo.period)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 active:bg-zinc-100"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {isOpen ? (
                    <ChevronDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-zinc-400" aria-hidden />
                  )}
                  <span className="truncate text-sm font-semibold text-zinc-800">
                    {monthLabel(mo.period)}
                  </span>
                </span>
                <span className="text-right text-sm font-bold tabular-nums text-zinc-900">
                  {baht(mo.total)}
                </span>
                <span className="w-12 text-right text-sm tabular-nums text-zinc-500">
                  {mo.count}
                </span>
              </button>

              {isOpen && (
                <ul className="space-y-px bg-zinc-50/60 px-2 pb-2">
                  {mo.rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/ledger/expenses?${baseParams}${baseParams ? "&" : ""}selected=${r.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-zinc-800">
                            {r.vendor || "ไม่ระบุผู้ขาย"}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                            <span className="font-mono">{r.docCode}</span>
                            <span>· {dayLabel(r.docDate)}</span>
                            {showBranch && r.branchName && (
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500">
                                {r.branchName}
                              </span>
                            )}
                            {r.status === "locked" && (
                              <span className="text-zinc-400">· ปิดงวด</span>
                            )}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-sm font-semibold tabular-nums text-zinc-800",
                          )}
                        >
                          {baht(r.total)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
