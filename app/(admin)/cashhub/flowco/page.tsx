import Link from "next/link";
import { Fuel, Info } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { fetchFlowcoDateRange } from "@/lib/cashhub/flowco-source";
import { fetchFlowcoReport } from "@/lib/cashhub/flowco-report";
import { FlowcoReportFilters } from "./flowco-report-filters";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const baht = (n: number) =>
  "฿" + Math.round(n).toLocaleString("th-TH");
const liters = (n: number) =>
  n.toLocaleString("th-TH", { maximumFractionDigits: 0 }) + " ล.";

export default async function FlowcoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; ste?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();
  const sp = await searchParams;

  const range = await fetchFlowcoDateRange(admin);
  const maxD = range.max ?? new Date().toISOString().slice(0, 10);
  const minD = range.min ?? maxD;
  const to = sp.to && YMD.test(sp.to) ? sp.to : maxD;
  const fromDefault = addDays(to, -29);
  const from =
    sp.from && YMD.test(sp.from)
      ? sp.from
      : fromDefault < minD
        ? minD
        : fromDefault;
  const steId = sp.ste && /^\d+$/.test(sp.ste) ? Number(sp.ste) : null;

  const report = await fetchFlowcoReport(admin, session.user.org_id, {
    dateFrom: from,
    dateTo: to,
    steId,
  });
  const t = report.totals;

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-6xl mx-auto ch-scope">
      <BackButton label="ศูนย์นำเข้าข้อมูล" fallbackHref="/cashhub/import" />

      <header className="mb-4 animate-fade-up flex flex-col gap-2">
        <SectionPill num="⛽" label="FlowCo · รายงานยอดขายปั๊ม" />
        <TwoToneTitle first="ยอดขาย" accent="ปั๊มน้ำมัน" size={30} />
        <p className="text-[var(--ch-text-2)] mt-1 text-sm flex items-center gap-1.5">
          <Info className="size-3.5 shrink-0" />
          ข้อมูล FlowCo เป็น <b>รายวัน</b> (ไม่มีแยกกะ) · แยกวิธีจ่ายได้ · กรองรายสาขา/ช่วงวันได้
        </p>
      </header>

      <FlowcoReportFilters
        branches={report.branches}
        from={from}
        to={to}
        ste={steId}
      />

      {/* summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 animate-fade-up">
        <Kpi label="ยอดขายรวม" value={baht(t.totalSales)} big />
        <Kpi label="ลิตรรวม" value={liters(t.liters)} />
        <Kpi label="จำนวนวัน-สาขา" value={t.days.toLocaleString("th-TH")} />
        <Kpi
          label="เฉลี่ย/วัน-สาขา"
          value={t.days ? baht(t.totalSales / t.days) : "—"}
        />
      </div>

      {/* payment split summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 animate-fade-up">
        <Kpi label="เงินสด" value={baht(t.cash)} tone />
        <Kpi label="บัตร" value={baht(t.card)} tone />
        <Kpi label="เงินเชื่อ" value={baht(t.credit)} tone />
        <Kpi label="โอน/QR/wallet" value={baht(t.transfer)} tone />
      </div>

      {/* branch cards — กดเลือกสาขา */}
      <div className="mt-4 animate-fade-up">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-[var(--ch-text)]">
            เลือกสาขา (กดเพื่อดูรายวัน)
          </p>
          {steId !== null && (
            <Link
              href={`/cashhub/flowco?from=${from}&to=${to}`}
              className="text-xs font-semibold text-[var(--ch-brand)]"
            >
              ← ดูทุกสาขา
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {report.branchSummary.map((b) => {
            const active = b.steId === steId;
            return (
              <Link
                key={b.steId}
                href={`/cashhub/flowco?from=${from}&to=${to}&ste=${b.steId}`}
                className={
                  "rounded-xl border p-2.5 transition-all hover:shadow-sm " +
                  (active
                    ? "border-[var(--ch-brand)] bg-[var(--ch-brand-50,#eef1ff)] ring-1 ring-[var(--ch-brand)]"
                    : "border-[var(--ch-border)] bg-white hover:border-[var(--ch-brand)]")
                }
              >
                <div className="text-xs font-semibold text-[var(--ch-text)] truncate">
                  {b.name}
                </div>
                <div className="text-base font-extrabold ch-tnum text-[var(--ch-brand)] mt-0.5">
                  {baht(b.totalSales)}
                </div>
                <div className="text-[10px] text-[var(--ch-text-2)]">
                  {b.days} วัน · {Math.round(b.liters).toLocaleString("th-TH")} ล.
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* table */}
      <div className="mt-4 rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden animate-fade-up">
        <div className="overflow-x-auto">
          <table className="w-full text-sm ch-table-v2">
            <thead>
              <tr className="text-left text-[var(--ch-text-2)] text-xs bg-[var(--ch-bg-2)]">
                <th className="px-3 py-2 font-semibold">วันที่</th>
                {steId === null && (
                  <th className="px-3 py-2 font-semibold">สาขา</th>
                )}
                <th className="px-3 py-2 font-semibold text-right">ลิตร</th>
                <th className="px-3 py-2 font-semibold text-right">ยอดขาย</th>
                <th className="px-3 py-2 font-semibold text-right">เงินสด</th>
                <th className="px-3 py-2 font-semibold text-right">บัตร</th>
                <th className="px-3 py-2 font-semibold text-right">เชื่อ</th>
                <th className="px-3 py-2 font-semibold text-right">โอน</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={steId === null ? 8 : 7}
                    className="px-3 py-8 text-center text-[var(--ch-text-2)]"
                  >
                    ไม่มีข้อมูลในช่วงที่เลือก
                  </td>
                </tr>
              )}
              {report.rows.map((r) => (
                <tr
                  key={`${r.steId}_${r.reportDate}`}
                  className="border-t border-[var(--ch-border)] hover:bg-[var(--ch-bg-2)]"
                >
                  <td className="px-3 py-2 whitespace-nowrap ch-tnum">
                    {r.reportDate}
                  </td>
                  {steId === null && (
                    <td className="px-3 py-2 whitespace-nowrap">{r.branchName}</td>
                  )}
                  <td className="px-3 py-2 text-right ch-tnum text-[var(--ch-text-2)]">
                    {Math.round(r.liters).toLocaleString("th-TH")}
                  </td>
                  <td className="px-3 py-2 text-right ch-tnum font-semibold">
                    {baht(r.totalSales)}
                  </td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.cash)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.card)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(r.credit)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">
                    {baht(r.transfer)}
                  </td>
                </tr>
              ))}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--ch-border)] font-bold bg-[var(--ch-bg-2)]">
                  <td className="px-3 py-2" colSpan={steId === null ? 2 : 1}>
                    รวม {t.days} วัน-สาขา
                  </td>
                  <td className="px-3 py-2 text-right ch-tnum">
                    {Math.round(t.liters).toLocaleString("th-TH")}
                  </td>
                  <td className="px-3 py-2 text-right ch-tnum">
                    {baht(t.totalSales)}
                  </td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(t.cash)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(t.card)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">{baht(t.credit)}</td>
                  <td className="px-3 py-2 text-right ch-tnum">
                    {baht(t.transfer)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-[var(--ch-text-2)] text-center flex items-center justify-center gap-1">
        <Fuel className="size-3" />
        ยอดขาย = ผลรวมทุกชนิดน้ำมัน · อ่านสด ๆ จากระบบ FlowCo (ไม่ต้องรอนำเข้า)
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--ch-border)] bg-white px-3 py-2">
      <div className="text-[11px] text-[var(--ch-text-2)]">{label}</div>
      <div
        className={
          "font-extrabold ch-tnum " +
          (big
            ? "text-xl text-[var(--ch-brand)]"
            : tone
              ? "text-base text-[var(--ch-text)]"
              : "text-lg text-[var(--ch-text)]")
        }
      >
        {value}
      </div>
    </div>
  );
}
