import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import {
  getPrimaryProject,
  listUnitsWithState,
  projectKpis,
} from "@/lib/rentspace/data";
import { formatBaht, tenantDisplayName, toNum, periodLabel } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsKpi, RsEmpty, RsCard } from "@/components/rentspace/ui";
import { SiteMap3D } from "@/components/rentspace/site-map-3d";

export const dynamic = "force-dynamic";

export default async function RentSpaceOverview() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <RsPage>
        <RsHeader title="บริหารพื้นที่เช่า" subtitle="ยังไม่มีโครงการ — เริ่มตั้งค่าก่อน" />
        <RsEmpty
          icon="🏬"
          title="ยังไม่มีโครงการ"
          hint="สร้างโครงการแรก (เช่น ทะเลทาวน์) แล้วเพิ่มห้อง · ผู้เช่า · สัญญา · ออกบิลอัตโนมัติ"
          action={
            <Link href="/rentspace/settings" className="rs-btn">
              ตั้งค่าโครงการ
            </Link>
          }
        />
      </RsPage>
    );
  }

  const [kpi, units] = await Promise.all([
    projectKpis(orgId, project.id),
    listUnitsWithState(orgId, project.id),
  ]);

  // plain serialisable units for the client map
  const mapUnits = units.map((u) => ({
    id: u.id,
    code: u.code,
    name: u.name,
    building: u.building,
    status: u.status as string,
    baseRentThb: toNum(u.baseRentThb),
    tenantName: u.tenant ? tenantDisplayName(u.tenant) : null,
    outstanding: u.outstanding,
    hasOverdue: u.hasOverdue,
    mapX: u.mapX != null ? toNum(u.mapX) : null,
    mapY: u.mapY != null ? toNum(u.mapY) : null,
    mapW: u.mapW != null ? toNum(u.mapW) : null,
    mapH: u.mapH != null ? toNum(u.mapH) : null,
  }));

  const attention = units
    .filter((u) => u.hasOverdue || u.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 8);

  const occupancyPct = kpi.units > 0 ? Math.round((kpi.occupied / kpi.units) * 100) : 0;

  return (
    <RsPage>
      <RsHeader
        title={project.name}
        subtitle={`ภาพรวมโครงการ · งวด ${periodLabel(kpi.period)}`}
        action={
          <Link href="/rentspace/meters" className="rs-btn">
            จดมิเตอร์เดือนนี้
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <RsKpi label="ห้องเช่า / ทั้งหมด" value={`${kpi.occupied}/${kpi.units}`} hint={`เข้าใช้ ${occupancyPct}% · ว่าง ${kpi.vacant}`} tone="ok" />
        <RsKpi
          label="ค้างชำระรวม"
          value={formatBaht(kpi.outstanding)}
          hint={kpi.overdueCount > 0 ? `เกินกำหนด ${kpi.overdueCount} ห้อง` : "ไม่มีเกินกำหนด"}
          tone={kpi.outstanding > 0 ? "danger" : "ok"}
        />
        <RsKpi label="ออกบิลเดือนนี้" value={formatBaht(kpi.billedThisMonth)} hint="ยอดรวมที่แจ้งหนี้" />
        <RsKpi label="เก็บได้เดือนนี้" value={formatBaht(kpi.collectedThisMonth)} hint="ยอดที่รับชำระแล้ว" tone="ok" />
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { href: "/rentspace/matrix", label: "📊 ตารางค่าเช่า (Excel)" },
          { href: "/rentspace/contracts", label: "ทำสัญญา / สัญญา" },
          { href: "/rentspace/bills", label: "ออกบิล / ใบแจ้งหนี้" },
          { href: "/rentspace/payments", label: "รับชำระ / อนุมัติส่วนลด" },
          { href: "/rentspace/tenants", label: "ผู้เช่า" },
          { href: "/rentspace/units", label: "ห้อง" },
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="rs-chip"
            style={{ textDecoration: "none" }}
          >
            {q.label}
          </Link>
        ))}
      </div>

      <RsCard className="overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div>
            <div className="text-base font-bold" style={{ color: "var(--rs-text)" }}>ผังโครงการ</div>
            <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
              คลิกห้องเพื่อดูข้อมูล · สลับมุมมอง 2D / 3D ได้
            </div>
          </div>
        </div>
        <SiteMap3D units={mapUnits} view3dEnabled={project.view3dEnabled} />
      </RsCard>

      <RsCard>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--rs-border)" }}>
          <div className="text-base font-bold" style={{ color: "var(--rs-text)" }}>ต้องติดตาม</div>
        </div>
        {attention.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--rs-text-3)" }}>
            ไม่มีห้องค้างชำระ 🎉
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--rs-border)" }}>
            {attention.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/rentspace/units/${u.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--rs-bg-2)]"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: "var(--rs-text)" }}>
                      {u.code} {u.name ? `· ${u.name}` : ""}
                    </div>
                    <div className="text-[12px] truncate" style={{ color: "var(--rs-text-3)" }}>
                      {u.tenant ? tenantDisplayName(u.tenant) : "ว่าง"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-sm" style={{ color: "var(--rs-danger)" }}>
                      {formatBaht(u.outstanding)}
                    </div>
                    <div className="text-[11px]" style={{ color: u.hasOverdue ? "var(--rs-danger)" : "var(--rs-text-3)" }}>
                      {u.hasOverdue ? "เกินกำหนด" : "ค้างชำระ"}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RsCard>
    </RsPage>
  );
}
