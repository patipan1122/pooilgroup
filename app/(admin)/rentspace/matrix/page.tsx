import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { rentMatrix } from "@/lib/rentspace/matrix-data";
import { getProjectReconcileSummary } from "@/lib/rentspace/ledger-push";
import { RsPage, RsHeader, RsBackLink, RsEmpty } from "@/components/rentspace/ui";
import MatrixGrid from "./_components/matrix-grid";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ year?: string; view?: string; month?: string }>;

export default async function MatrixPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <RsPage>
        <RsHeader title="ตารางค่าเช่า (มุมมอง Excel)" subtitle="สรุปค่าเช่าทุกห้องแบบสเปรดชีต" />
        <RsEmpty
          icon="🏬"
          title="ยังไม่มีโครงการ"
          hint="ต้องสร้างโครงการก่อนจึงจะดูตารางค่าเช่าได้"
          action={
            <Link href="/rentspace/settings" className="rs-btn">
              ไปที่ตั้งค่า
            </Link>
          }
        />
      </RsPage>
    );
  }

  const sp = await searchParams;
  const nowYear = new Date().getFullYear(); // CE year
  const year = Number(sp.year) || nowYear;
  const view = sp.view === "month" ? "month" : "year";
  const month = Math.min(12, Math.max(1, Number(sp.month) || new Date().getMonth() + 1));

  const matrix = await rentMatrix(orgId, project.id, year);

  // แอดมิน/แอดมินโปรแกรม RentSpace จัดลำดับห้องเองได้ (ตรงกับด่านหลังบ้าน gateAdmin) —
  // สิทธิ์ชุดเดียวกันนี้ใช้เป็นด่านโชว์ปุ่ม "ส่งเข้าบัญชี LedgerLine" ด้วย (gateAdmin ฝั่ง
  // server action เช็คเงื่อนไขเดียวกันเป๊ะ — ไม่โชว์ปุ่มให้คนที่กดแล้วจะโดนปฏิเสธอยู่ดี)
  const canReorder =
    isAdminTier(session.user.role) || (await userIsModuleAdmin(session.user, "rentspace"));

  const reconcileSummary = canReorder ? await getProjectReconcileSummary(orgId, project.id) : null;

  const beYear = year + 543;

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก RentSpace" />
      <RsHeader
        title="ตารางค่าเช่า (มุมมอง Excel)"
        subtitle={`${project.name} · ${matrix.units.length} ห้อง · ปี ${beYear}`}
        action={
          <div className="flex items-center gap-1">
            <Link
              href={`/rentspace/matrix?year=${year - 1}&view=${view}&month=${month}`}
              className="rs-btn-ghost inline-flex h-9 w-9 items-center justify-center !p-0"
              aria-label="ปีก่อนหน้า"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span
              className="min-w-[64px] text-center text-sm font-bold tabular-nums"
              style={{ color: "var(--rs-text)" }}
            >
              {beYear}
            </span>
            <Link
              href={`/rentspace/matrix?year=${year + 1}&view=${view}&month=${month}`}
              className="rs-btn-ghost inline-flex h-9 w-9 items-center justify-center !p-0"
              aria-label="ปีถัดไป"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <p className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
        ช่องว่าง = ยังไม่ออกบิล (แสดงค่าเช่าพื้นฐานที่คาดไว้) · แตะที่ช่องเพื่อดูรายละเอียดบิล
      </p>

      {/* legend สีสถานะบิล — CEO เคยงงว่าสีไหนคืออะไร (ไม่มีคำอธิบาย) · เล็ก 1 บรรทัด wrap ได้ · สี token เดิม */}
      <div
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]"
        style={{ color: "var(--rs-text-2)" }}
      >
        <span style={{ color: "var(--rs-text-3)" }}>สีช่อง:</span>
        {[
          { label: "จ่ายครบ", tone: "ok" },
          { label: "ออกบิลแล้ว รอจ่าย", tone: "info" },
          { label: "จ่ายบางส่วน", tone: "pending" },
          { label: "เกินกำหนด", tone: "danger" },
        ].map(({ label, tone }) => (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-[3px]"
              style={{ background: `var(--rs-${tone}-soft)`, border: `1px solid var(--rs-${tone})` }}
            />
            {label}
          </span>
        ))}
      </div>

      <MatrixGrid
        year={year}
        view={view}
        month={month}
        units={matrix.units}
        cells={matrix.cells}
        monthsTotals={matrix.monthsTotals}
        projectId={project.id}
        canReorder={canReorder}
        reconcileSummary={reconcileSummary}
      />
    </RsPage>
  );
}
