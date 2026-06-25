// Playland · บันทึกอุบัติเหตุ/เหตุการณ์ — หลังบ้าน (AdminShell · พื้นขาว · LOCKED tokens)
// กันคดี · เคลมประกัน · ลงทุกเหตุการณ์เด็กบาดเจ็บ/ทะเลาะ (CEO 2026-06-25)
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandCashier } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { IncidentForm } from "@/components/playland/incident-form";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { ArrowLeft, ShieldAlert, AlertTriangle, BellRing } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "บันทึกอุบัติเหตุ/เหตุการณ์ · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

const KIND_LABEL: Record<string, string> = { injury: "บาดเจ็บ", conflict: "ทะเลาะวิวาท", health: "ป่วย-สุขภาพ", property: "ทรัพย์สินเสียหาย", "lost-child": "เด็กหลง", other: "อื่นๆ" };
const SEV: Record<string, { t: string; color: string; bg: string }> = {
  minor: { t: "เล็กน้อย", color: MUTED, bg: "#f4ede0" },
  moderate: { t: "ปานกลาง", color: AMBER, bg: "#fbf2dc" },
  serious: { t: "ร้ายแรง", color: RED, bg: "#fdecea" },
};

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandCashier(session.user.role); // พนักงาน (staff) ลงเหตุการณ์เองได้ (CEO 2026-06-25)
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId;
  if (!branchId) redirect("/playland/settings/branches");

  const incidents = await prisma.playlandIncident.findMany({
    where: { orgId, branchId },
    orderBy: { occurredAt: "desc" },
    take: 30,
    select: { id: true, kind: true, severity: true, childName: true, location: true, occurredAt: true, parentNotified: true, description: true },
  });

  // KPI — เดือนนี้: จำนวนครั้ง · ร้ายแรงกี่ครั้ง · แจ้งผู้ปกครองแล้วกี่ %
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thisMonth = incidents.filter((i) => new Date(i.occurredAt) >= monthStart);
  const monthCount = thisMonth.length;
  const seriousCount = thisMonth.filter((i) => i.severity === "serious").length;
  const notifiedPct = monthCount > 0 ? Math.round((thisMonth.filter((i) => i.parentNotified).length / monthCount) * 100) : 0;
  const monthLabel = new Date().toLocaleDateString("th-TH", { month: "long" });

  const kpis = [
    { label: `เหตุการณ์เดือน${monthLabel}`, value: String(monthCount), sub: "ครั้ง", icon: <ShieldAlert size={16} color={BLUE} />, valColor: INK },
    { label: "ร้ายแรง", value: String(seriousCount), sub: seriousCount > 0 ? "ต้องติดตามใกล้ชิด" : "ไม่มี", icon: <AlertTriangle size={16} color={seriousCount > 0 ? RED : GREEN} />, valColor: seriousCount > 0 ? RED : GREEN },
    { label: "แจ้งผู้ปกครองแล้ว", value: `${notifiedPct}%`, sub: `จาก ${monthCount} เหตุการณ์`, icon: <BellRing size={16} color={notifiedPct >= 100 ? GREEN : AMBER} />, valColor: notifiedPct >= 100 ? GREEN : AMBER },
  ];

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip — title + back + ตัวสลับสาขา */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <Link href={`/playland?branch=${branchId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: MUTED, textDecoration: "none", fontSize: 13 }}><ArrowLeft size={16} /> Playland</Link>
        <div style={{ width: 1, height: 24, background: LINE }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ShieldAlert size={19} /> บันทึกอุบัติเหตุ/เหตุการณ์</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>กันคดี · เคลมประกัน · บันทึกทุกเหตุการณ์เด็กบาดเจ็บ/ทะเลาะ</div>
        </div>
        <div style={{ marginLeft: "auto" }}><BranchSwitcher branches={branches} activeId={activeId} /></div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        {/* KPI row */}
        <div className="pl-kpi-row" style={{ marginBottom: 18 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ ...card, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED, marginBottom: 8 }}>{k.icon} {k.label}</div>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24, color: k.valColor }}>{k.value}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ฟอร์มซ้าย + ประวัติเหตุการณ์ขวา */}
        <div className="pl-grid-2" style={{ alignItems: "start" }}>
          <IncidentForm branchId={branchId} />

          <section style={{ ...card, padding: 22 }}>
            <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 14px" }}>เหตุการณ์ล่าสุด</h2>
            {incidents.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีบันทึกเหตุการณ์</div>
            ) : (
              <div style={{ border: `1px solid #f2ebdd`, borderRadius: 12, overflow: "hidden" }}>
                {incidents.map((i) => {
                  const sev = SEV[i.severity] ?? SEV.minor;
                  return (
                    <div key={i.id} style={{ padding: "14px 16px", borderBottom: "1px solid #f2ebdd" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: sev.bg, color: sev.color }}>{sev.t}</span>
                        <div style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{KIND_LABEL[i.kind] ?? i.kind}{i.childName ? ` · ${i.childName}` : ""}</div>
                        {i.parentNotified
                          ? <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: "#eaf3eb", color: GREEN }}>แจ้งผู้ปกครองแล้ว</span>
                          : <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: "#fbf2dc", color: AMBER }}>ยังไม่แจ้ง</span>}
                        <div style={{ fontFamily: MONO, fontSize: 12, color: "#a89c8b" }}>{new Date(i.occurredAt).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" })} {new Date(i.occurredAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      {i.location && <div style={{ fontSize: 12, color: "#a89c8b", marginTop: 3 }}>📍 {i.location}</div>}
                      {i.description && <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{i.description}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
