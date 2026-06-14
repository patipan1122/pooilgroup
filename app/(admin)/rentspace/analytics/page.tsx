import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { revenueAnalytics } from "@/lib/rentspace/analytics";
import { formatBaht, periodLabel } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsBackLink, RsEmpty } from "@/components/rentspace/ui";
import RollingChart from "./_components/rolling-chart";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <RsPage>
        <RsHeader title="วิเคราะห์รายได้" subtitle="สรุปยอดออกบิล · เก็บได้ · ค้างชำระ ของโครงการ" />
        <RsEmpty
          icon="🏬"
          title="ยังไม่มีโครงการ"
          hint="ต้องสร้างโครงการก่อนจึงจะดูสรุปรายได้ได้"
          action={
            <Link href="/rentspace/settings" className="rs-btn">
              ไปที่ตั้งค่า
            </Link>
          }
        />
      </RsPage>
    );
  }

  const { thisPeriod, rolling12 } = await revenueAnalytics(orgId, project.id);

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก RentSpace" />
      <RsHeader
        title="วิเคราะห์รายได้"
        subtitle={`${project.name} · งวด ${periodLabel(thisPeriod.period)}`}
      />

      {/* KPI cards — mirror ชำระแล้ว / ค้างชำระ / รวมสุทธิ (Horganice labels) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid var(--rs-border)", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
          <div className="flex items-center gap-2 text-[12.5px] mb-2" style={{ color: "var(--rs-text-2)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rs-ok)" strokeWidth="1.8"><path d="M20 6L9 17l-5-5" /></svg>
            ชำระแล้ว
          </div>
          <div className="text-2xl font-bold tracking-tight tabular-nums" style={{ color: "var(--rs-ok)" }}>
            {formatBaht(thisPeriod.collected)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--rs-text-3)" }}>เก็บได้ในงวดนี้</div>
        </div>

        <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid var(--rs-border)", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
          <div className="flex items-center gap-2 text-[12.5px] mb-2" style={{ color: "var(--rs-text-2)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rs-danger)" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            ค้างชำระ
          </div>
          <div
            className="text-2xl font-bold tracking-tight tabular-nums"
            style={{ color: thisPeriod.outstanding > 0 ? "var(--rs-danger)" : "var(--rs-ok)" }}
          >
            {formatBaht(thisPeriod.outstanding)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--rs-text-3)" }}>ยอดค้างทั้งหมด (รวมงวดก่อน)</div>
        </div>

        <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid var(--rs-border)", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
          <div className="flex items-center gap-2 text-[12.5px] mb-2" style={{ color: "var(--rs-text-2)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rs-info)" strokeWidth="1.8"><path d="M6 2h9l3 3v17l-2.2-1.4L13.6 22l-2.3-1.4L9 22l-2.3-1.4L4 22V4a2 2 0 012-2z" /></svg>
            รวมสุทธิ
          </div>
          <div className="text-2xl font-bold tracking-tight tabular-nums" style={{ color: "var(--rs-text)" }}>
            {formatBaht(thisPeriod.net)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--rs-text-3)" }}>ออกบิลรวมงวดนี้</div>
        </div>
      </div>

      {/* 12-month rolling chart */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ border: "1px solid var(--rs-border)", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
        <div className="px-5 pt-4 pb-1">
          <div className="font-semibold text-[15.5px]" style={{ color: "var(--rs-text)" }}>
            สรุปรายรับย้อนหลัง 12 เดือน
          </div>
          <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            เทียบยอดออกบิล (ฟ้า) กับยอดที่เก็บได้จริง (เขียว) แต่ละเดือน
          </div>
        </div>
        <RollingChart rolling12={rolling12} />
      </div>
    </RsPage>
  );
}
