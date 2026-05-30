/**
 * ClawFleet v2 — Team & สาขา (real data, replaces placeholder).
 * Lists all claw branches for the org + assigned staff + manager + machine count.
 */

import Link from "next/link";
import { Ic, StatTile, Section } from "@/components/clawfleet/v2/chrome";
import { getTeamData } from "@/lib/clawfleet/v2-admin-queries";

export const dynamic = "force-dynamic";

const ROLE_TH: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  admin: "Admin",
  area_manager: "ผจก. เขต",
  branch_manager: "ผจก. สาขา",
  staff: "พนักงาน",
  viewer: "ดูอย่างเดียว",
};

export default async function TeamPage() {
  const data = await getTeamData();

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">ทีม & สาขา</div>
          <h1 className="cf-h1">สาขาตู้คีบทั้งหมด</h1>
          <div className="cf-page-sub">
            {data.totals.branches} สาขา · {data.totals.machines} ตู้ · พนักงาน {data.totals.staff} คน
          </div>
        </div>
        <div className="cf-page-actions">
          <Link href="/clawfleet/machines" className="cf-btn cf-btn-ghost">
            <Ic name="package" size={14} /> จัดการตู้
          </Link>
          <Link href="/clawfleet/setup" className="cf-btn cf-btn-primary">
            <Ic name="settings" size={14} /> ตั้งค่าสาขา
          </Link>
        </div>
      </div>

      <div className="cf-insight-cards">
        <StatTile label="สาขา" value={data.totals.branches} sub="ที่เปิดอยู่" icon="building" tone="primary" />
        <StatTile label="ตู้คีบ" value={data.totals.machines} sub="ทุกสาขารวมกัน" icon="package" tone="neutral" />
        <StatTile label="พนักงาน" value={data.totals.staff} sub="ที่ได้รับสิทธิ์" icon="users" tone="neutral" />
        <StatTile
          label="มี ผจก."
          value={`${data.totals.withManager}/${data.totals.branches}`}
          sub="สาขาที่ตั้งผู้จัดการ"
          icon="user"
          tone={data.totals.withManager < data.totals.branches ? "amber" : "neutral"}
        />
      </div>

      <Section title="รายสาขา" sub="คลิกจัดการตู้/พนักงานที่หน้า setup">
        {data.branches.length === 0 ? (
          <div className="cf-dim" style={{ padding: 24, textAlign: "center" }}>
            ยังไม่มีสาขาตู้คีบในระบบ
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {data.branches.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
                  gap: 16,
                  padding: 16,
                  border: "1px solid var(--cf-border)",
                  borderRadius: "var(--cf-radius)",
                  background: "var(--cf-surface)",
                }}
              >
                <div>
                  <div className="cf-eyebrow">{b.area}</div>
                  <h2 className="cf-h2" style={{ margin: "4px 0" }}>{b.name}</h2>
                  <div className="cf-dim" style={{ fontSize: 12 }}>
                    {b.code} · {b.machinesCount} ตู้ · ผจก. {b.managerName ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="cf-eyebrow">พนักงานในสาขา · {b.staff.length} คน</div>
                  {b.staff.length === 0 ? (
                    <div className="cf-dim" style={{ fontSize: 12, marginTop: 6 }}>
                      ยังไม่มีพนักงานในสาขา
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {b.staff.map((s) => (
                        <span
                          key={s.id}
                          className="cf-pill cf-pill-slate cf-pill-sm"
                          title={s.email ?? ""}
                        >
                          {s.name}
                          <span className="cf-dim"> · {ROLE_TH[s.role] ?? s.role}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
