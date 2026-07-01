import { AlertTriangle } from "lucide-react";
import type { FlowcoReportRow, FlowcoReportTotals } from "@/lib/cashhub/flowco-report";

const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const litersFmt = (n: number) =>
  n > 0.5 ? Math.round(n).toLocaleString("th-TH") : "–";

export function FlowcoReportTable({
  rows,
  totals,
  colLabel,
  fuelCols,
}: {
  rows: FlowcoReportRow[];
  totals: FlowcoReportTotals;
  colLabel: string;
  fuelCols: string[];
}) {
  const span = 1 + fuelCols.length + 6; // label + fuel + (ลิตรรวม,ยอดขาย,เงินสด,บัตร,เชื่อ,โอน)
  return (
    <div className="rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--ch-text-2)] text-xs bg-[var(--ch-bg-2)] text-left">
              <th className="px-3 py-2 font-semibold sticky left-0 bg-[var(--ch-bg-2)] z-10">
                {colLabel}
              </th>
              {fuelCols.map((f) => (
                <th key={f} className="px-3 py-2 font-semibold text-right whitespace-nowrap">
                  {f}
                  <span className="block text-[9px] font-normal opacity-70">ลิตร</span>
                </th>
              ))}
              <th className="px-3 py-2 font-semibold text-right">ลิตรรวม</th>
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
                {fuelCols.map((f) => (
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
              {fuelCols.map((f) => (
                <td key={f} className="px-3 py-2 text-right ch-tnum">
                  {litersFmt(totals.fuelLiters[f] ?? 0)}
                </td>
              ))}
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
