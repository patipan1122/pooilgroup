"use client";

import { useState } from "react";
import { AlertTriangle, Columns3, ChevronDown, Sun, Moon } from "lucide-react";
import type { FlowcoReportRow, FlowcoReportTotals } from "@/lib/cashhub/flowco-report";

const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const litersFmt = (n: number) =>
  n > 0.5 ? Math.round(n).toLocaleString("th-TH") : "–";

export function FlowcoReportTable({
  rows,
  totals,
  colLabel,
  fuelCols,
  hasShift,
}: {
  rows: FlowcoReportRow[];
  totals: FlowcoReportTotals;
  colLabel: string;
  fuelCols: string[];
  hasShift: boolean;
}) {
  // default = ย่อ (โชว์แค่ลิตรรวม+ยอดขาย+วิธีจ่าย) · กดขยายค่อยเห็นแยกชนิดน้ำมัน/แยกกะ
  const [showFuel, setShowFuel] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const cols = showFuel ? fuelCols : [];
  const span = 1 + cols.length + 6 + (showShift ? 2 : 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {fuelCols.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFuel((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors " +
              (showFuel
                ? "border-[var(--ch-brand)] bg-[var(--ch-brand-50,#eef1ff)] text-[var(--ch-brand)]"
                : "border-[var(--ch-border)] text-[var(--ch-text-2)] hover:border-[var(--ch-brand)]")
            }
          >
            <Columns3 className="size-3.5" />
            {showFuel ? "ซ่อนแยกชนิดน้ำมัน" : "แสดงแยกชนิดน้ำมัน (ลิตร)"}
            <ChevronDown
              className={"size-3 transition-transform " + (showFuel ? "rotate-180" : "")}
            />
          </button>
        )}
        {hasShift && (
          <button
            type="button"
            onClick={() => setShowShift((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors " +
              (showShift
                ? "border-[var(--ch-brand)] bg-[var(--ch-brand-50,#eef1ff)] text-[var(--ch-brand)]"
                : "border-[var(--ch-border)] text-[var(--ch-text-2)] hover:border-[var(--ch-brand)]")
            }
          >
            <Sun className="size-3.5" />
            {showShift ? "ซ่อนแยกกะ" : "แสดงแยกกะ (เช้า/ดึก)"}
            <ChevronDown
              className={"size-3 transition-transform " + (showShift ? "rotate-180" : "")}
            />
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--ch-text-2)] text-xs bg-[var(--ch-bg-2)] text-left">
                <th className="px-3 py-2 font-semibold sticky left-0 bg-[var(--ch-bg-2)] z-10">
                  {colLabel}
                </th>
                {cols.map((f) => (
                  <th
                    key={f}
                    className="px-3 py-2 font-semibold text-right whitespace-nowrap bg-[var(--ch-brand-50,#eef1ff)]"
                  >
                    {f}
                    <span className="block text-[9px] font-normal opacity-70">ลิตร</span>
                  </th>
                ))}
                <th className="px-3 py-2 font-semibold text-right">ลิตรรวม</th>
                <th className="px-3 py-2 font-semibold text-right">ยอดขาย</th>
                {showShift && (
                  <>
                    <th className="px-3 py-2 font-semibold text-right whitespace-nowrap bg-[var(--ch-brand-50,#eef1ff)]">
                      <span className="inline-flex items-center gap-0.5">
                        <Sun className="size-3" /> กะเช้า
                      </span>
                    </th>
                    <th className="px-3 py-2 font-semibold text-right whitespace-nowrap bg-[var(--ch-brand-50,#eef1ff)]">
                      <span className="inline-flex items-center gap-0.5">
                        <Moon className="size-3" /> กะดึก
                      </span>
                    </th>
                  </>
                )}
                <th className="px-3 py-2 font-semibold text-right">เงินสด</th>
                <th className="px-3 py-2 font-semibold text-right">บัตร</th>
                <th className="px-3 py-2 font-semibold text-right">เชื่อ</th>
                <th className="px-3 py-2 font-semibold text-right">โอน</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={span} className="px-3 py-8 text-center text-[var(--ch-text-2)]">
                    ไม่มีข้อมูลในช่วงที่เลือก
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-t border-[var(--ch-border)] hover:bg-[var(--ch-bg-2)]"
                >
                  <td className="px-3 py-2 whitespace-nowrap font-medium sticky left-0 bg-white z-10">
                    <span className="inline-flex items-center gap-1.5">
                      {r.label}
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
                  {cols.map((f) => (
                    <td
                      key={f}
                      className="px-3 py-2 text-right ch-tnum text-[var(--ch-text-2)]"
                    >
                      {litersFmt(r.fuelLiters[f] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right ch-tnum text-[var(--ch-text)]">
                    {litersFmt(r.liters)}
                  </td>
                  <td className="px-3 py-2 text-right ch-tnum font-bold">
                    {baht(r.totalSales)}
                  </td>
                  {showShift && (
                    <>
                      <td className="px-3 py-2 text-right ch-tnum">
                        {r.shiftMorning > 0.5 ? baht(r.shiftMorning) : "–"}
                      </td>
                      <td className="px-3 py-2 text-right ch-tnum">
                        {r.shiftEvening > 0.5 ? baht(r.shiftEvening) : "–"}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.cash)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.card)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.credit)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.transfer)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--ch-border)] font-bold bg-[var(--ch-bg-2)]">
                <td className="px-3 py-2 sticky left-0 bg-[var(--ch-bg-2)] z-10">รวม</td>
                {cols.map((f) => (
                  <td key={f} className="px-3 py-2 text-right ch-tnum">
                    {litersFmt(totals.fuelLiters[f] ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right ch-tnum">{litersFmt(totals.liters)}</td>
                <td className="px-3 py-2 text-right ch-tnum">{baht(totals.totalSales)}</td>
                {showShift && (
                  <>
                    <td className="px-3 py-2 text-right ch-tnum">
                      {baht(totals.shiftMorning)}
                    </td>
                    <td className="px-3 py-2 text-right ch-tnum">
                      {baht(totals.shiftEvening)}
                    </td>
                  </>
                )}
                <td className="px-3 py-2 text-right ch-tnum">{baht(totals.cash)}</td>
                <td className="px-3 py-2 text-right ch-tnum">{baht(totals.card)}</td>
                <td className="px-3 py-2 text-right ch-tnum">{baht(totals.credit)}</td>
                <td className="px-3 py-2 text-right ch-tnum">{baht(totals.transfer)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
