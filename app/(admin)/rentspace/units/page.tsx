import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { getPrimaryProject, listUnitsWithState, listBuildingsWithUnits } from "@/lib/rentspace/data";
import { formatBaht, tenantDisplayName, toNum, currentPeriod } from "@/lib/rentspace/format";
import { promoStatus } from "@/lib/rentspace/billing";
import { RsPage, RsHeader, RsBadge, RsEmpty } from "@/components/rentspace/ui";
import UnitForm from "./_components/unit-form";
import BuildingManager from "./_components/building-manager";

export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const isAdmin = isAdminTier(session.user.role);
  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <RsPage>
        <RsHeader title="ห้องเช่า" subtitle="จัดการห้อง/ยูนิตในโครงการ" />
        <RsEmpty
          icon="🏗️"
          title="ยังไม่มีโครงการ"
          hint="ตั้งค่าโครงการเช่าก่อนในหน้า ตั้งค่า เพื่อเริ่มเพิ่มห้อง"
          action={
            <Link href="/rentspace/settings" className="rs-btn">
              ไปที่ตั้งค่า
            </Link>
          }
        />
      </RsPage>
    );
  }

  const [units, buildingData] = await Promise.all([
    listUnitsWithState(orgId, project.id),
    listBuildingsWithUnits(orgId, project.id),
  ]);
  const period = currentPeriod();

  // จัดกลุ่มตาม "อาคาร" (entity) เรียงตามลำดับที่ตั้งไว้ (sortOrder) · ห้องไม่มีอาคาร = ท้ายสุด
  type Row = (typeof units)[number];
  const groups = new Map<string, { label: string; zone: string | null; order: number; rows: Row[] }>();
  for (const u of units) {
    const ref = u.buildingRef;
    const key = ref?.id ?? (u.building?.trim() ? `name:${u.building.trim()}` : "__none__");
    const label = ref?.name ?? (u.building?.trim() || "ไม่ระบุอาคาร");
    const order = ref?.sortOrder ?? (key === "__none__" ? 99999 : 9999);
    if (!groups.has(key)) groups.set(key, { label, zone: ref?.zone ?? null, order, rows: [] });
    groups.get(key)!.rows.push(u);
  }
  const groupList = [...groups.values()].sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, "th"),
  );

  return (
    <RsPage>
      <RsHeader
        title="ห้องเช่า"
        subtitle={`${project.name} · ${units.length} ห้อง · ${buildingData.buildings.length} อาคาร`}
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <BuildingManager
                projectId={project.id}
                buildings={buildingData.buildings.map((b) => ({ id: b.id, name: b.name, zone: b.zone, sortOrder: b.sortOrder }))}
                units={buildingData.units.map((u) => ({ id: u.id, code: u.code, name: u.name, buildingId: u.buildingId, status: u.status as string }))}
              />
            )}
            <UnitForm projectId={project.id} />
          </div>
        }
      />

      {units.length === 0 ? (
        <RsEmpty
          icon="🚪"
          title="ยังไม่มีห้อง"
          hint="กดปุ่ม เพิ่มห้อง เพื่อสร้างห้องเช่าห้องแรก"
          action={<UnitForm projectId={project.id} />}
        />
      ) : (
        <div className="space-y-6">
          {groupList.map((g) => {
            const rows = g.rows;
            return (
              <section key={g.label + g.order} className="space-y-2">
                <h2 className="text-sm font-semibold px-1" style={{ color: "var(--rs-text-2)" }}>
                  {g.label}
                  {g.zone ? <span style={{ color: "var(--rs-text-3)" }}> · โซน {g.zone}</span> : null}
                  <span style={{ color: "var(--rs-text-3)" }}> · {rows.length}</span>
                </h2>
                <div className="rs-card overflow-x-auto">
                  <table className="rs-table w-full min-w-[820px] text-sm">
                    <thead>
                      <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">รหัสห้อง</th>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">ชื่อร้าน</th>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">ผู้เช่า</th>
                        <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">ค่าเช่า/เดือน</th>
                        <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">ส่วนลด</th>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">สถานะ</th>
                        <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">ค้างชำระ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((u) => {
                        const outstanding = toNum(u.outstanding);
                        const rent = u.contract ? toNum(u.contract.rentAmountThb) : toNum(u.baseRentThb);
                        const promo = u.contract ? promoStatus(u.contract, period) : null;
                        return (
                          <tr
                            key={u.id}
                            className="border-t hover:bg-[var(--rs-bg-2)] transition-colors"
                            style={{ borderColor: "var(--rs-border)" }}
                          >
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <Link
                                href={`/rentspace/units/${u.id}`}
                                className="font-semibold"
                                style={{ color: "var(--rs-brand)" }}
                              >
                                {u.code}
                              </Link>
                            </td>
                            <td className="py-2.5 px-3" style={{ color: "var(--rs-text)" }}>
                              {u.name || <span style={{ color: "var(--rs-text-3)" }}>—</span>}
                            </td>
                            <td className="py-2.5 px-3" style={{ color: "var(--rs-text-2)" }}>
                              {u.tenant ? (
                                <Link
                                  href={`/rentspace/tenants/${u.tenant.id}`}
                                  className="hover:underline"
                                  style={{ color: "var(--rs-brand)" }}
                                >
                                  {tenantDisplayName(u.tenant)}
                                </Link>
                              ) : (
                                <span style={{ color: "var(--rs-text-3)" }}>ว่าง</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap" style={{ color: "var(--rs-text)" }}>
                              {rent > 0 ? formatBaht(rent) : <span style={{ color: "var(--rs-text-3)" }}>—</span>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                              {promo && promo.active ? (
                                <span title={`ส่วนลด ${formatBaht(promo.perMonth)}/เดือน · เหลืออีก ${promo.monthsLeft} เดือน`}>
                                  <span style={{ color: "var(--rs-ok)" }}>−{formatBaht(promo.perMonth)}</span>
                                  <span className="block text-[11px]" style={{ color: "var(--rs-text-3)" }}>
                                    เหลือ {promo.monthsLeft} เดือน
                                  </span>
                                </span>
                              ) : (
                                <span style={{ color: "var(--rs-text-3)" }}>—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <RsBadge kind="unit" status={u.status} />
                            </td>
                            <td
                              className="py-2.5 px-3 text-right tabular-nums font-medium whitespace-nowrap"
                              style={{ color: outstanding > 0 ? "var(--rs-danger)" : "var(--rs-text-3)" }}
                            >
                              {outstanding > 0 ? formatBaht(outstanding) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </RsPage>
  );
}
