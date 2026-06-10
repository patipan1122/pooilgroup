// Spend pivot table — the CEO's hand-kept Google sheet, automated.
//
//   rows = chosen axis (สาขา/หมวด/ผู้ขาย/ผู้บันทึก) · cols = เดือน/ปี · cell = ยอด
//   + a right-most row total + a bottom ยอดรวม row.
//
// Mobile (<sm): a 12-column grid is unreadable on a phone, so the default is a
// COMPACT list (label · ยอดล่าสุด · Δ% vs ก่อนหน้า), tap a row to expand its
// per-period values; a "ดูทั้งตาราง" toggle reveals the full horizontally-
// scrollable matrix with a frozen first column. Desktop (sm+): the full matrix.
//
// Drill (reuses the rich category drill): row → /ledger/categories/[id] when the
// axis is หมวด; when a category is filtered AND axis=สาขา, a branch row → that
// category × that branch (the existing receipt-level drill). Otherwise the row is
// display-only (vendor/person have no dedicated drill page yet).
"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PivotResult, RowAxis } from "@/lib/ledger/spend-analytics";

function baht(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const TH_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function periodLabel(period: string): string {
  if (/^\d{4}$/.test(period)) return `${Number(period) + 543}`; // year grain → BE year
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${TH_SHORT[m - 1] ?? period} ${String((y + 543) % 100).padStart(2, "0")}`;
}

function DeltaPill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] text-zinc-400">—</span>;
  const up = pct > 0.5;
  const down = pct < -0.5;
  // Near-zero change is noise — show a muted dash, not a styled "•" pill.
  if (!up && !down) return <span className="text-[11px] text-zinc-400">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        up ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600",
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
    </span>
  );
}

export function PivotTable({
  pivot,
  axis,
  categoryIds,
  baseQs,
}: {
  pivot: PivotResult;
  axis: RowAxis;
  /** Ticked category filter(s). A branch-row drill into the rich category page
   *  is only unambiguous when exactly ONE category is ticked. */
  categoryIds: string[];
  /** Scope query string (company=..&branch=..) without leading "?". */
  baseQs: string;
}) {
  const soleCategoryId = categoryIds.length === 1 ? categoryIds[0] : null;
  const [showFull, setShowFull] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (pivot.rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-12 text-center">
        <p className="text-sm font-medium text-zinc-600">ยังไม่มีข้อมูลในช่วงนี้</p>
        <p className="mt-1 text-xs text-zinc-400">ลองปรับตัวกรอง หรือเลือกช่วงเวลาที่กว้างขึ้น</p>
      </div>
    );
  }

  const { periods, rows, columnTotals, grandTotal } = pivot;
  const lastIdx = periods.length - 1;

  const rowHref = (key: string): string | null => {
    if (key === "none") return null;
    const qp = new URLSearchParams(baseQs);
    if (axis === "category") {
      return `/ledger/categories/${key}${qp.toString() ? `?${qp}` : ""}`;
    }
    if (axis === "branch" && soleCategoryId) {
      qp.set("axis", "branch");
      qp.set("b", key);
      return `/ledger/categories/${soleCategoryId}?${qp}`;
    }
    return null;
  };

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      {pivot.truncated && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ข้อมูลมากเกินกว่าจะรวมทั้งหมดในครั้งเดียว — ตัวเลขอาจไม่ครบ ลองแคบช่วงเวลาหรือกรองหมวด/สาขา
        </p>
      )}

      {/* ---- Mobile: compact Δ% list (default) ---- */}
      <div className="sm:hidden">
        {!showFull ? (
          <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
            {rows.map((r) => {
              const href = rowHref(r.key);
              const isOpen = open.has(r.key);
              const latest = r.cells[lastIdx] ?? 0;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => toggle(r.key)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2 px-3 py-3 text-left active:bg-zinc-50"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-zinc-300" aria-hidden />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-zinc-300" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-800">{r.label}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-400">
                        ล่าสุด {periodLabel(periods[lastIdx])} · รวม {baht(r.rowTotal)} ฿
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-sm font-bold tabular-nums text-zinc-900">{baht(latest)} ฿</span>
                      <DeltaPill pct={r.deltaPct} />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="bg-zinc-50/60 px-3 pb-3">
                      <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {periods.map((p, i) => (
                          <li key={p} className="flex items-center justify-between text-[12px]">
                            <span className="text-zinc-500">{periodLabel(p)}</span>
                            <span className="tabular-nums text-zinc-700">{baht(r.cells[i] ?? 0)}</span>
                          </li>
                        ))}
                      </ul>
                      {href && (
                        <Link
                          href={href}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)]"
                        >
                          ดูใบ/รายละเอียด <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <FullMatrix
            periods={periods}
            rows={rows}
            columnTotals={columnTotals}
            grandTotal={grandTotal}
            periodLabel={periodLabel}
          />
        )}

        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="mt-2 w-full rounded-xl border border-zinc-200 bg-white py-2 text-sm font-medium text-[var(--color-brand-600)]"
        >
          {showFull ? "ดูแบบสรุป (เดือนนี้ + %เทียบ)" : `ดูทั้งตาราง (${periods.length} ${pivot.grain === "year" ? "ปี" : "เดือน"})`}
        </button>
      </div>

      {/* ---- Desktop: full matrix ---- */}
      <div className="hidden sm:block">
        <FullMatrix
          periods={periods}
          rows={rows}
          columnTotals={columnTotals}
          grandTotal={grandTotal}
          periodLabel={periodLabel}
          rowHref={rowHref}
        />
      </div>
    </div>
  );
}

function FullMatrix({
  periods,
  rows,
  columnTotals,
  grandTotal,
  periodLabel,
  rowHref,
}: {
  periods: string[];
  rows: PivotResult["rows"];
  columnTotals: number[];
  grandTotal: number;
  periodLabel: (p: string) => string;
  rowHref?: (key: string) => string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-zinc-50/80 text-xs font-semibold text-zinc-500">
            <th className="sticky left-0 z-10 bg-zinc-50/80 px-3 py-2.5 text-left shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">รายการ</th>
            {periods.map((p) => (
              <th key={p} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                {periodLabel(p)}
              </th>
            ))}
            <th className="whitespace-nowrap px-3 py-2.5 text-right">รวม</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => {
            const href = rowHref?.(r.key) ?? null;
            return (
              <tr key={r.key} className="hover:bg-zinc-50">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[12rem] truncate bg-white px-3 py-2.5 text-left font-medium text-zinc-800"
                  title={r.label}
                >
                  {href ? (
                    <Link href={href} className="text-[var(--color-brand-700)] hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </th>
                {r.cells.map((v, i) => (
                  <td key={i} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700">
                    {v ? baht(v) : <span className="text-zinc-400">–</span>}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-zinc-900">
                  {baht(r.rowTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-zinc-200 bg-zinc-50/80 font-bold text-zinc-900">
            <th scope="row" className="sticky left-0 z-10 bg-zinc-50/80 px-3 py-2.5 text-left">
              ยอดรวม
            </th>
            {columnTotals.map((v, i) => (
              <td key={i} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                {baht(v)}
              </td>
            ))}
            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[var(--color-brand-700)]">
              {baht(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
