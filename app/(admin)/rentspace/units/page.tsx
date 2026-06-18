import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject, listUnitsWithState } from "@/lib/rentspace/data";
import { formatBaht, tenantDisplayName, toNum, currentPeriod } from "@/lib/rentspace/format";
import { promoStatus } from "@/lib/rentspace/billing";
import { RsPage, RsHeader, RsBadge, RsEmpty } from "@/components/rentspace/ui";
import UnitForm from "./_components/unit-form";

export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
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

  const units = await listUnitsWithState(orgId, project.id);
  const period = currentPeriod();

  // group by building (ungrouped → "อื่นๆ"), keep data-layer sort within group
  const groups = new Map<string, typeof units>();
  for (const u of units) {
    const key = u.building?.trim() || "ไม่ระบุอาคาร";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(u);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "th"));

  return (
    <RsPage>
      <RsHeader
        title="ห้องเช่า"
        subtitle={`${project.name} · ${units.length} ห้อง`}
        action={<UnitForm projectId={project.id} />}
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
          {groupKeys.map((g) => {
            const rows = groups.get(g)!;
            return (
              <section key={g} className="space-y-2">
                <h2 className="text-sm font-semibold px-1" style={{ color: "var(--rs-text-2)" }}>
                  {g} <span style={{ color: "var(--rs-text-3)" }}>· {rows.length}</span>
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
