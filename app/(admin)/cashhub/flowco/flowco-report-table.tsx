"use client";

import { useEffect, useState } from "react";
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
  // เลือกแถว → โชว์แยกชนิดน้ำมันในแผงด้านขวา (ไม่ดันตารางลงล่าง)
  const [selected, setSelected] = useState<string | null>(rows[0]?.key ?? null);
  useEffect(() => {
    // reset เมื่อ rows เปลี่ยน (เปลี่ยนสาขา/ช่วงวัน/โหมด)
    setSelected(rows[0]?.key ?? null);
  }, [rows]);

  const sel = rows.find((r) => r.key === selected) ?? null;

  return (
    <div className="flex flex-col lg:flex-row gap-3">
      {/* ตาราง (ซ้าย) */}
      <div className="flex-1 min-w-0 rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
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
                const active = r.key === selected;
                const hasGrades = r.grades.length > 0;
                return (
                  <tr
                    key={r.key}
                    onClick={() => hasGrades && setSelected(r.key)}
                    className={
                      "border-t border-[var(--ch-border)] " +
                      (hasGrades ? "cursor-pointer " : "") +
                      (active
                        ? "bg-[var(--ch-brand-50,#eef1ff)]"
                        : "hover:bg-[var(--ch-bg-2)]")
                    }
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight
                          className={
                            "size-3.5 transition-colors " +
                            (active
                              ? "text-[var(--ch-brand)]"
                              : "text-[var(--ch-text-2)]")
                          }
                        />
                        <span className={active ? "font-bold" : "font-medium"}>
                          {r.label}
                        </span>
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
                    <td className="px-3 py-2 text-right ch-tnum font-bold">
                      {baht(r.totalSales)}
                    </td>
                    <td className="px-3 py-2 text-right ch-tnum">{baht(r.cash)}</td>
                    <td className="px-3 py-2 text-right ch-tnum">{baht(r.card)}</td>
                    <td className="px-3 py-2 text-right ch-tnum">{baht(r.credit)}</td>
                    <td className="px-3 py-2 text-right ch-tnum">{baht(r.transfer)}</td>
                  </tr>
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

      {/* แผงแยกชนิดน้ำมัน (ขวา) */}
      <aside className="lg:w-72 shrink-0 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-4">
          <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ch-text)]">
            <Droplet className="size-4 text-[var(--ch-brand)]" /> แยกตามชนิดน้ำมัน
          </div>
          {sel ? (
            <>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs text-[var(--ch-text-2)]">{sel.label}</span>
                <span className="text-sm font-extrabold ch-tnum text-[var(--ch-brand)]">
                  {baht(sel.totalSales)}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {sel.grades.map((g) => {
                  const pct = sel.totalSales
                    ? Math.round((g.sales / sel.totalSales) * 100)
                    : 0;
                  return (
                    <div key={g.gradeId}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--ch-text)] truncate">
                          {g.grade}
                        </span>
                        <span className="ch-tnum font-semibold text-[var(--ch-text)] shrink-0">
                          {baht(g.sales)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--ch-bg-2)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--ch-brand)]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--ch-text-2)] ch-tnum w-16 text-right shrink-0">
                          {litersFmt(g.liters)} ล.
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-[var(--ch-text-2)]">
              กดแถวในตารางเพื่อดูยอดแยกตามชนิดน้ำมันของวันนั้น
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
