// Playland · ของหาย-ของเก็บได้ (Lost & Found) — หลังบ้าน (AdminShell · พื้นขาว · LOCKED tokens)
// ฟอร์มบันทึกซ้าย + รายการของที่ยังเก็บอยู่ขวา + ประวัติคืน/ทิ้งด้านล่าง (CEO 2026-06-25)
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { CareDeleteButton } from "@/components/playland/care-delete-button";
import { PackageSearch, Archive, RotateCcw, Clock } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "ของหาย · ของเก็บได้ · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

const DAY = 86_400_000;
const fmtDT = (d: Date) => new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  claimed: { text: "คืนแล้ว", color: GREEN, bg: "#eaf3eb" },
  disposed: { text: "ทิ้ง/บริจาค", color: AMBER, bg: "#f6efe2" },
};

export default async function LostFoundPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role)); // ดูอย่างเดียว · ผู้จัดการเท่านั้น (บันทึก/คืนของย้ายไปหน้าร้าน)
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId;
  if (!branchId) redirect("/playland/settings/branches");

  const [stored, history] = await Promise.all([
    prisma.playlandLostFound.findMany({ where: { orgId, branchId, status: "stored" }, orderBy: { foundAt: "desc" } }),
    prisma.playlandLostFound.findMany({ where: { orgId, branchId, status: { in: ["claimed", "disposed"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  // KPI: เก็บอยู่กี่ชิ้น · คืนแล้วเดือนนี้ · เก็บนานเกิน 30 วัน
  const now = Date.now();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const claimedThisMonth = history.filter((h) => h.status === "claimed" && h.claimedAt && new Date(h.claimedAt) >= monthStart).length;
  const overdue = stored.filter((s) => now - new Date(s.foundAt).getTime() > 30 * DAY);
  const overdueColor = overdue.length > 0 ? RED : GREEN;

  const kpis = [
    { label: "เก็บอยู่ตอนนี้", value: String(stored.length), sub: "ชิ้น (ยังไม่มีคนมารับ)", icon: <Archive size={16} color={BLUE} />, valColor: INK },
    { label: "คืนแล้วเดือนนี้", value: String(claimedThisMonth), sub: "เจอเจ้าของ", icon: <RotateCcw size={16} color={GREEN} />, valColor: GREEN },
    { label: "เก็บนานเกิน 30 วัน", value: String(overdue.length), sub: overdue.length > 0 ? "ควรพิจารณาทิ้ง/บริจาค" : "ยังไม่มี", icon: <Clock size={16} color={overdueColor} />, valColor: overdueColor },
  ];

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><PackageSearch size={19} /> ของหาย · ของเก็บได้</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>บันทึกของที่เด็ก/ลูกค้าลืม · ตามเจ้าของ · ลดเรื่องทะเลาะ</div>
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

        {/* ดูอย่างเดียว — รายการเต็มกว้าง (บันทึก/คืนของย้ายไปหน้าร้าน) */}
        <div style={{ display: "grid", gap: 18 }}>
          {/* ของที่ยังเก็บอยู่ */}
          <section style={{ ...card, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "0 0 14px" }}>
              <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: 0 }}>ของที่ยังเก็บอยู่ ({stored.length})</h2>
              <span style={{ fontSize: 12, color: MUTED }}>ดูอย่างเดียว · บันทึกที่หน้าร้าน</span>
            </div>
            {stored.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีของที่เก็บไว้</div>
            ) : (
              <div style={{ border: `1px solid #f2ebdd`, borderRadius: 12, overflow: "hidden" }}>
                {stored.map((s) => {
                  const days = Math.floor((now - new Date(s.foundAt).getTime()) / DAY);
                  const old = now - new Date(s.foundAt).getTime() > 30 * DAY;
                  return (
                    <div key={s.id} style={{ padding: "14px 16px", borderBottom: "1px solid #f2ebdd" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 15 }}>{s.itemName}</div>
                        <div style={{ fontFamily: MONO, fontSize: 11, color: "#a89c8b" }}>{s.itemCode}</div>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: old ? RED : "#a89c8b" }}>{days === 0 ? "วันนี้" : `${days} วัน`}</div>
                        <CareDeleteButton kind="lostfound" id={s.id} />
                      </div>
                      <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
                        {s.foundLocation ? `เก็บได้ที่ ${s.foundLocation} · ` : ""}{fmtDT(s.foundAt)}
                        {s.contactPhone ? ` · ☎ ${s.contactPhone}` : ""}
                      </div>
                      {s.description && <div style={{ fontSize: 13, color: "#6b6052", marginTop: 2 }}>{s.description}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ประวัติคืน/ทิ้ง */}
          <section style={{ ...card, padding: 22 }}>
            <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 14px" }}>ประวัติคืน/ทิ้ง</h2>
            {history.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีประวัติ</div>
            ) : (
              <div style={{ border: `1px solid #f2ebdd`, borderRadius: 12, overflow: "hidden" }}>
                {history.map((h) => {
                  const st = STATUS_LABEL[h.status] ?? { text: h.status, color: MUTED, bg: "#f4ede0" };
                  return (
                    <div key={h.id} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 16px", borderBottom: "1px solid #f2ebdd", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
                        {h.itemName}
                        {h.status === "claimed" && h.claimedByName && <span style={{ color: MUTED }}> · รับโดย {h.claimedByName}</span>}
                      </div>
                      <span style={{ fontSize: 12, color: st.color, background: st.bg, padding: "3px 10px", borderRadius: 999 }}>{st.text}</span>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: "#a89c8b" }}>{fmtDT(h.claimedAt ?? h.createdAt)}</div>
                      <CareDeleteButton kind="lostfound" id={h.id} />
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
