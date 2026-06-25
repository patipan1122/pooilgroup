// Playland · หน้าบ้าน (staff/kiosk) — ของหาย · ของเก็บ เต็มจอ สำหรับพนักงานหน้าร้าน
// บันทึกของที่เก็บได้ + รายการ "ยังเก็บอยู่" พร้อมปุ่มคืน/ทิ้ง (เจ้าของมาที่เคาน์เตอร์ → พนักงานกดคืน)
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandCashier } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { LostFoundForm, LostFoundActions } from "@/components/playland/lost-found-form";
import { StaffScreenShell } from "@/components/playland/care/staff-screen-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "ของหาย · ของเก็บ · หน้าร้าน · Play a lot" };

const MUTED = "#8a7f70";
const RED = "#E74C3C";
const LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const DAY = 86_400_000;
const fmtDT = (d: Date) => new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function CareLostFoundPage() {
  const session = await requireSession();
  requirePlaylandCashier(session.user.role);
  const { activeId } = await getBranchContext(session.user.org_id);

  if (!activeId) {
    return (
      <StaffScreenShell title="ของหาย · ของเก็บ" subtitle="สำหรับพนักงานหน้าร้าน">
        <div style={{ color: MUTED, fontSize: 15, padding: "40px 0", textAlign: "center" }}>
          เลือกสาขาก่อนเริ่มบันทึก
        </div>
      </StaffScreenShell>
    );
  }

  const stored = await prisma.playlandLostFound.findMany({
    where: { orgId: session.user.org_id, branchId: activeId, status: "stored" },
    orderBy: { foundAt: "desc" },
  });
  const now = Date.now();

  return (
    <StaffScreenShell title="ของหาย · ของเก็บ" subtitle="สำหรับพนักงานหน้าร้าน">
      <div style={{ display: "grid", gap: 22 }}>
        {/* ฟอร์มบันทึกของที่เก็บได้ */}
        <LostFoundForm branchId={activeId} />

        {/* รายการที่ยังเก็บอยู่ — เจ้าของมารับ → กดคืน/ทิ้ง */}
        <section style={{ ...card, padding: 22 }}>
          <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 14px" }}>
            ของที่ยังเก็บอยู่ ({stored.length})
          </h2>
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
                    </div>
                    <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
                      {s.foundLocation ? `เก็บได้ที่ ${s.foundLocation} · ` : ""}{fmtDT(s.foundAt)}
                      {s.contactPhone ? ` · ☎ ${s.contactPhone}` : ""}
                    </div>
                    {s.description && <div style={{ fontSize: 13, color: "#6b6052", marginTop: 2 }}>{s.description}</div>}
                    <LostFoundActions itemId={s.id} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </StaffScreenShell>
  );
}
