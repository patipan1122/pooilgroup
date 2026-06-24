// Playland · ซ่อมเครื่อง + เบิกอะไหล่ — หลังบ้าน (อยู่ในเมนูเดิม AdminShell · พื้นขาว · LOCKED tokens)
// เลย์เอาต์/การสื่อสารจากดีไซน์ Stock→บันทึกซ่อม: ฟอร์มซ้าย + KPI สรุป + ประวัติซ่อม (CEO 2026-06-24)
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandCashier } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb } from "@/lib/playland/format";
import { RepairForm } from "@/components/playland/repair-form";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { ArrowLeft, Wrench, PackageX, Coins } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "ซ่อม · อะไหล่ · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function RepairsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandCashier(session.user.role); // ช่าง/พนักงาน (staff) บันทึกซ่อมเองได้ (CEO 2026-06-24)
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch); // ?branch= → cookie → สาขาแรก (สิทธิ์กรองแล้ว)
  const branchId = activeId;
  if (!branchId) redirect("/playland/settings/branches");

  const [parts, repairs] = await Promise.all([
    prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true, kind: "SPARE_PART" }, orderBy: { name: "asc" }, select: { id: true, name: true, stock: true, costCents: true, barcode: true } }),
    prisma.playlandRepairLog.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 30, include: { parts: true } }),
  ]);
  const machineLabels = [...new Set(repairs.map((r) => r.machineLabel))]; // ชื่อเครื่องที่เคยซ่อม → autocomplete กันสะกดไม่ตรง

  // KPI สรุป — เดือนนี้ (จำนวนครั้ง + ค่าอะไหล่รวม) + อะไหล่ใกล้หมด
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const repairsThisMonth = repairs.filter((r) => new Date(r.createdAt) >= monthStart);
  const repairCount = repairsThisMonth.length;
  const partsCostCents = repairsThisMonth.reduce((a, r) => a + r.partsCostCents, 0);
  const lowParts = parts.filter((p) => p.stock <= 0);
  const monthLabel = new Date().toLocaleDateString("th-TH", { month: "long" });

  const kpis = [
    { label: `ซ่อมเดือน${monthLabel}`, value: String(repairCount), sub: "ครั้ง", icon: <Wrench size={16} color={BLUE} />, valColor: INK },
    { label: "ค่าอะไหล่รวม", value: thb(partsCostCents), sub: `${monthLabel} ที่ผ่านมา`, icon: <Coins size={16} color={AMBER} />, valColor: AMBER },
    { label: "อะไหล่หมดสต๊อก", value: String(lowParts.length), sub: lowParts.length > 0 ? lowParts.slice(0, 2).map((p) => p.name).join(" · ") : "พอใช้งาน", icon: <PackageX size={16} color={lowParts.length > 0 ? "#E74C3C" : GREEN} />, valColor: lowParts.length > 0 ? "#E74C3C" : GREEN },
  ];

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip — title + back + ตัวสลับสาขา */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <Link href={`/playland/stock?branch=${branchId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: MUTED, textDecoration: "none", fontSize: 13 }}><ArrowLeft size={16} /> สต๊อก</Link>
        <div style={{ width: 1, height: 24, background: LINE }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><Wrench size={19} /> ซ่อมเครื่อง · เบิกอะไหล่</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>บันทึกการซ่อม แล้วตัดสต๊อกอะไหล่อัตโนมัติ</div>
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

        {/* ฟอร์มซ้าย + ประวัติซ่อมขวา (เต็มกว้าง) */}
        <div className="pl-grid-2" style={{ alignItems: "start" }}>
          <RepairForm branchId={branchId} parts={parts} machineLabels={machineLabels} />

          <section style={{ ...card, padding: 22 }}>
            <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 14px" }}>ประวัติการซ่อมล่าสุด</h2>
            {repairs.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีประวัติซ่อม</div>
            ) : (
              <div style={{ border: `1px solid #f2ebdd`, borderRadius: 12, overflow: "hidden" }}>
                {repairs.map((r) => (
                  <div key={r.id} style={{ padding: "14px 16px", borderBottom: "1px solid #f2ebdd" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <div style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{r.machineLabel}</div>
                      <div style={{ fontFamily: MONO, fontWeight: 600, color: AMBER, fontSize: 14 }}>{thb(r.partsCostCents)}</div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: "#a89c8b" }}>{new Date(r.createdAt).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" })}</div>
                    </div>
                    {r.description && <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{r.description}</div>}
                    {r.parts.length > 0 && <div style={{ fontSize: 13, color: "#6b6052", marginTop: 4 }}>อะไหล่: {r.parts.map((p) => `${p.productName}×${p.quantity}`).join(" · ")}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
