import { Info, AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { fetchFlowcoDateRange } from "@/lib/cashhub/flowco-source";
import { fetchFlowcoReport, type FlowcoMode } from "@/lib/cashhub/flowco-report";
import { FlowcoReportFilters } from "./flowco-report-filters";
import { FlowcoReportTable } from "./flowco-report-table";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");

export default async function FlowcoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; ste?: string; mode?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();
  const sp = await searchParams;

  const mode: FlowcoMode = sp.mode === "month" ? "month" : "day";
  const range = await fetchFlowcoDateRange(admin);
  const maxD = range.max ?? new Date().toISOString().slice(0, 10);
  const minD = range.min ?? maxD;
  const to = sp.to && YMD.test(sp.to) ? sp.to : maxD;
  const defFrom = mode === "month" ? minD : addDays(to, -29);
  const from =
    sp.from && YMD.test(sp.from) ? sp.from : defFrom < minD ? minD : defFrom;
  const steId = sp.ste && /^\d+$/.test(sp.ste) ? Number(sp.ste) : null;

  const report = await fetchFlowcoReport(admin, session.user.org_id, {
    dateFrom: from,
    dateTo: to,
    steId,
    mode,
  });
  const t = report.totals;

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto ch-scope">
      <BackButton label="ศูนย์นำเข้าข้อมูล" fallbackHref="/cashhub/import" />

      <header className="mb-4 animate-fade-up flex flex-col gap-1.5">
        <SectionPill num="⛽" label="FlowCo · รายงานยอดขายปั๊ม" />
        <TwoToneTitle
          first="ยอดขาย"
          accent={report.branchName ?? "ปั๊มน้ำมัน"}
          size={30}
        />
        <p className="text-[var(--ch-text-2)] text-xs flex items-center gap-1.5">
          <Info className="size-3.5 shrink-0" />
          ข้อมูลรายวัน · เลือกสาขา + ช่วงวัน · สลับ รายวัน/รายเดือน · กดแถวเพื่อดูแยกชนิดน้ำมัน
        </p>
      </header>

      <FlowcoReportFilters
        branches={report.branches}
        from={from}
        to={to}
        ste={steId}
        mode={mode}
      />

      {report.anomalyTotal > 0 && (
        <div className="mt-3 rounded-xl border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e] flex items-start gap-2 animate-fade-up">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            กรองข้อมูลผิดปกติออก <b>{report.anomalyTotal}</b> รายการ (ค่าติดลบ/มิเตอร์รีเซ็ต
            — ยอดต่อชนิดเกิน 5 ล้านบาท หรือเกินแสนลิตร/วัน) เพื่อไม่ให้ยอดเพี้ยน ·
            แถวที่มีเครื่องหมาย ⚠️ คือวันที่มีการกรอง
          </span>
        </div>
      )}

      {/* summary — compact */}
      <div className="mt-3 rounded-2xl border border-[var(--ch-border)] bg-white p-4 animate-fade-up">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-[var(--ch-text-2)]">ยอดขายรวม</div>
            <div className="text-2xl font-extrabold ch-tnum text-[var(--ch-brand)]">
              {baht(t.totalSales)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--ch-text-2)]">ลิตรรวม</div>
            <div className="text-lg font-bold ch-tnum text-[var(--ch-text)]">
              {Math.round(t.liters).toLocaleString("th-TH")} ล.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <PayPill label="เงินสด" value={baht(t.cash)} />
          <PayPill label="บัตร" value={baht(t.card)} />
          <PayPill label="เงินเชื่อ" value={baht(t.credit)} />
          <PayPill label="โอน/QR" value={baht(t.transfer)} />
        </div>
      </div>

      <div className="mt-3 animate-fade-up">
        <FlowcoReportTable
          rows={report.rows}
          totals={t}
          colLabel={mode === "month" ? "เดือน" : "วันที่"}
        />
      </div>

      <p className="mt-3 text-[11px] text-[var(--ch-text-2)] text-center">
        ยอดขาย = ผลรวมทุกชนิดน้ำมัน · อ่านสด ๆ จาก FlowCo · FlowCo ไม่มีข้อมูลกะ (รายวัน)
      </p>
    </div>
  );
}

function PayPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--ch-bg-2)] px-3 py-1.5">
      <div className="text-[10px] text-[var(--ch-text-2)]">{label}</div>
      <div className="text-sm font-bold ch-tnum text-[var(--ch-text)]">{value}</div>
    </div>
  );
}
