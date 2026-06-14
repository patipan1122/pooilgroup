import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { rentMatrix } from "@/lib/rentspace/matrix-data";
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

      <MatrixGrid
        year={year}
        view={view}
        month={month}
        units={matrix.units}
        cells={matrix.cells}
        monthsTotals={matrix.monthsTotals}
      />
    </RsPage>
  );
}
