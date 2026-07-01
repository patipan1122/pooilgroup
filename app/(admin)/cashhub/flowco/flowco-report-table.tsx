"use client";

import { useState } from "react";
import { ChevronRight, AlertTriangle, Droplet } from "lucide-react";
import type { FlowcoReportRow, FlowcoReportTotals } from "@/lib/cashhub/flowco-report";

const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const litersFmt = (n: number) => Math.round(n).toLocaleString("th-TH");

export function FlowcoReportTable({
  rows,
  totals,
  colLabel,
}: {
  rows: FlowcoReportRow[];
  totals: FlowcoReportTotals;
  colLabel: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-[var(--ch-text-2)] text-xs bg-[var(--ch-bg-2)] text-left">
              <th className="px-3 py-2 font-semibold">{colLabel}</th>
              <th className="px-3 py-2 font-semibold text-right">ลิตร</th>
              <th className="px-3 py-2 font-semibold text-right">ยอดขาย</th>
              <th className="px-3 py-2 font-semibold text-right">เงินสด</th>
              <th className="px-3 py-2 font-semibold text-right">บัตร</th>
              <th className="px-3 py-2 font-semibold text-right">เชื่อ</th>
              <th className="px-3 py-2 font-semibold text-right">โอน</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--ch-text-2)]">
                  ไม่มีข้อมูลในช่วงที่เลือก
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = open.has(r.key);
              const hasGrades = r.grades.length > 0;
              return (
                <FragmentRow
                  key={r.key}
                  r={r}
                  isOpen={isOpen}
                  hasGrades={hasGrades}
                  onToggle={() => hasGrades && toggle(r.key)}
                />
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--ch-border)] font-bold bg-[var(--ch-bg-2)]">
              <td className="px-3 py-2">รวม</td>
              <td className="px-3 py-2 text-right ch-tnum">{litersFmt(totals.liters)}</td>
              <td className="px-3 py-2 text-right ch-tnum">{baht(totals.totalSales)}</td>
              <td className="px-3 py-2 text-right ch-tnum">{baht(totals.cash)}</td>
              <td className="px-3 py-2 text-right ch-tnum">{baht(totals.card)}</td>
              <td className="px-3 py-2 text-right ch-tnum">{baht(totals.credit)}</td>
              <td className="px-3 py-2 text-right ch-tnum">{baht(totals.transfer)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  r,
  isOpen,
  hasGrades,
  onToggle,
}: {
  r: FlowcoReportRow;
  isOpen: boolean;
  hasGrades: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={
          "border-t border-[var(--ch-border)] " +
          (hasGrades ? "cursor-pointer hover:bg-[var(--ch-bg-2)]" : "")
        }
      >
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            {hasGrades ? (
              <ChevronRight
                className={
                  "size-3.5 text-[var(--ch-text-2)] transition-transform " +
                  (isOpen ? "rotate-90" : "")
                }
              />
            ) : (
              <span className="inline-block size-3.5" />
            )}
            <span className="font-medium">{r.label}</span>
            {r.anomalyCount > 0 && (
              <span
                title={`กรองข้อมูลผิดปกติ ${r.anomalyCount} รายการออก`}
                className="inline-flex items-center gap-0.5 text-[10px] text-[#b45309]"
              >
                <AlertTriangle className="size-3" />
                {r.anomalyCount}
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-2 text-right ch-tnum text-[var(--ch-text-2)]">
          {litersFmt(r.liters)}
        </td>
        <td className="px-3 py-2 text-right ch-tnum font-bold">{baht(r.totalSales)}</td>
        <td className="px-3 py-2 text-right ch-tnum">{baht(r.cash)}</td>
        <td className="px-3 py-2 text-right ch-tnum">{baht(r.card)}</td>
        <td className="px-3 py-2 text-right ch-tnum">{baht(r.credit)}</td>
        <td className="px-3 py-2 text-right ch-tnum">{baht(r.transfer)}</td>
      </tr>
      {isOpen && hasGrades && (
        <tr className="bg-[var(--ch-bg-2)]">
          <td colSpan={7} className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--ch-text-2)] mb-1.5 flex items-center gap-1">
              <Droplet className="size-3" /> แยกตามชนิดน้ำมัน
            </div>
            <div className="grid gap-1">
              {r.grades.map((g) => (
                <div
                  key={g.gradeId}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg bg-white border border-[var(--ch-border)] px-3 py-1.5 text-xs"
                >
                  <span className="font-medium text-[var(--ch-text)]">{g.grade}</span>
                  <span className="ch-tnum text-[var(--ch-text-2)] text-right w-24">
                    {litersFmt(g.liters)} ล.
                  </span>
                  <span className="ch-tnum font-semibold text-right w-28">
                    {baht(g.sales)}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
