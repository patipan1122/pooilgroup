// Playland · Audit Log — feed/timeline ตามดีไซน์ Admin (ไอคอน · ผู้ทำ+การกระทำ · รายละเอียด · เวลา ขวา mono)
// อยู่ในเมนูเดิม (AdminShell) + พื้นขาว + สไตล์ Play a lot · ตัด BackOfficeTabs (หน้า/หลังปน) ออก
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandAdmin } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtTime, thb } from "@/lib/playland/format";
import { AuditCategoryTabs } from "@/components/playland/audit-category-tabs";
import { History, Banknote, DoorOpen, Activity } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Log · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

// หมวด → ไอคอน + สีพื้นไอคอน (เงิน=แดง · device/ประตู=น้ำเงิน · ทั่วไป=เทา)
const CAT_STYLE: Record<string, { bg: string; fg: string; Icon: typeof History }> = {
  money: { bg: "#fdeceb", fg: RED, Icon: Banknote },
  device: { bg: "#eaf3f6", fg: BLUE, Icon: DoorOpen },
  general: { bg: "#f4efe6", fg: MUTED, Icon: Activity },
};

// ดึงเลขเงิน (cents) จาก snapshot ถ้ามี เพื่อโชว์จำนวนเงินในบรรทัดหลัก
function pickAmountCents(after: unknown): number | null {
  if (!after || typeof after !== "object") return null;
  const o = after as Record<string, unknown>;
  for (const k of ["amountCents", "totalCents", "refundCents", "priceCents"]) {
    const v = o[k];
    if (typeof v === "number") return v;
  }
  return null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandAdmin(session.user.role); // ประวัติการกระทำทั้งระบบ = แอดมินเท่านั้น
  const orgId = session.user.org_id;

  const where = {
    orgId,
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.q ? { OR: [{ action: { contains: sp.q } }, { entityType: { contains: sp.q } }] } : {}),
  };

  const [logs, totalCount] = await Promise.all([
    prisma.playlandAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.playlandAuditLog.count({ where: { orgId } }),
  ]);

  // จัดกลุ่มตามวัน เพื่ออ่านง่ายเหมือน timeline
  const byDate = new Map<string, typeof logs>();
  for (const l of logs) {
    const day = new Date(l.createdAt).toISOString().slice(0, 10);
    (byDate.get(day) ?? byDate.set(day, []).get(day)!).push(l);
  }

  const subtitle = `${logs.length} รายการล่าสุด · เก็บย้อนหลัง 90 วัน`;

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip — title + ฟิลเตอร์หมวด/ค้นหา (ในหน้า ไม่ใช่ tab หน้า/หลัง) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><History size={20} color={BLUE} /> Audit Log</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{subtitle}</div>
        </div>
        <form style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <AuditCategoryTabs current={sp.category ?? null} />
          <input
            name="q"
            placeholder="ค้นหา action / entity…"
            defaultValue={sp.q ?? ""}
            style={{ width: 220, border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 12px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none" }}
          />
        </form>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        {logs.length === 0 ? (
          <div style={{ ...card, padding: 48, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f4efe6", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><History size={22} color={MUTED} /></div>
            <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>ยังไม่มี log</div>
            <div style={{ fontSize: 13, color: MUTED }}>ทุกการกระทำ (login · register · refund · ปิดกะ ฯลฯ) จะถูกบันทึกที่นี่</div>
          </div>
        ) : (
          <>
            {Array.from(byDate.entries()).map(([day, items]) => (
              <div key={day} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 8, fontWeight: 600 }}>{fmtDate(new Date(day))} · {items.length} รายการ</div>
                <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                  {items.map((l, i) => {
                    const cat = CAT_STYLE[l.category] ?? CAT_STYLE.general;
                    const Icon = cat.Icon;
                    const amount = pickAmountCents(l.after);
                    const actor = l.actorRole ?? "ระบบ";
                    const entity = l.entityId ? `${l.entityType} #${l.entityId.slice(0, 6)}` : l.entityType;
                    const detail = l.after ? JSON.stringify(l.after) : null;
                    return (
                      <div key={l.id} style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "13px 18px", borderTop: i === 0 ? "none" : `1px solid #f2ebdd` }}>
                        {/* ไอคอนประเภท */}
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: cat.bg, display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1 }}>
                          <Icon size={17} color={cat.fg} />
                        </div>
                        {/* ใคร + ทำอะไร + จำนวน · รายละเอียดบรรทัดรอง */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, lineHeight: 1.4 }}>
                            <strong style={{ fontWeight: 600 }}>{actor}</strong>
                            <span style={{ margin: "0 6px", color: BLUE, fontWeight: 500 }}>{l.action}</span>
                            <span style={{ color: MUTED }}>{entity}</span>
                            {amount != null && <span style={{ marginLeft: 8, fontFamily: MONO, fontWeight: 600, color: AMBER }}>{thb(amount)}</span>}
                          </div>
                          {detail && (
                            <div style={{ fontSize: 11, color: "#b3a896", fontFamily: MONO, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</div>
                          )}
                        </div>
                        {/* เวลา ขวา mono */}
                        <div style={{ fontFamily: MONO, fontSize: 12, color: MUTED, whiteSpace: "nowrap", flexShrink: 0, marginTop: 2 }}>{fmtTime(l.createdAt)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 6 }}>
              แสดง {logs.length} จาก {totalCount.toLocaleString("th-TH")} รายการ · เก็บย้อนหลัง 90 วัน
            </div>
          </>
        )}
      </div>
    </div>
  );
}
