import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { fmtDate, thb } from "@/lib/playland/format";
import { Tag } from "lucide-react";

export const dynamic = "force-dynamic";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const th: React.CSSProperties = { fontSize: 11.5, color: MUTED, fontWeight: 600, textAlign: "left", padding: "11px 14px", borderBottom: `1px solid ${LINE}` };
const td: React.CSSProperties = { fontSize: 13.5, padding: "12px 14px", borderBottom: `1px solid #f2ebdd` };
const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: "2px 10px", background: bg, color: fg });

export default async function PromosSettingsPage() {
  const session = await requireSession();
  const { activeId, active } = await getBranchContext(session.user.org_id);
  // โปรของสาขานี้ + ที่ตั้งเป็น "ทุกสาขา" (branchId null)
  const promos = await prisma.playlandPromo.findMany({ where: { orgId: session.user.org_id, ...(activeId ? { OR: [{ branchId: activeId }, { branchId: null }] } : {}) }, orderBy: { createdAt: "desc" } });
  return (
    <div style={{ fontFamily: MITR, color: INK, padding: "22px 28px 44px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 600, fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}>
            <Tag size={19} color={BLUE} /> Promo / Coupon · {promos.length}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            ส่วนลด · คูปอง{active && <> · <span style={{ color: BLUE }}>{active.name}</span></>}
          </div>
        </div>
        <span style={{ ...chip("#fdf3df", "#a9791a"), marginLeft: "auto", padding: "5px 12px", fontSize: 12 }}>🚧 โปรโมชั่นกำลังพัฒนา</span>
      </div>

      {promos.length === 0 ? (
        <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", color: MUTED, textAlign: "center" }}>
          <Tag size={32} opacity={0.4} />
          <div>ยังไม่มี promo · ตอนนี้เป็น stub · เปิดใช้งานจริงใน Phase 9</div>
        </div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Type</th><th style={th}>Code</th><th style={th}>Name</th>
              <th style={{ ...th, textAlign: "right" }}>ส่วนลด</th><th style={{ ...th, textAlign: "right" }}>ใช้ไป</th>
              <th style={th}>หมดอายุ</th><th style={{ ...th, textAlign: "center" }}>Active</th>
            </tr></thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id}>
                  <td style={td}><span style={chip("#eaf2fb", BLUE)}>{p.type}</span></td>
                  <td style={td}><span style={{ fontFamily: MONO, fontSize: 12 }}>{p.code ?? "—"}</span></td>
                  <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>{p.discountPercent ? `${p.discountPercent}%` : p.discountCents ? thb(p.discountCents) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>{p.usesCount} / {p.maxUses ?? "∞"}</td>
                  <td style={{ ...td, color: MUTED }}>{p.endsAt ? fmtDate(p.endsAt) : "ไม่กำหนด"}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {p.active ? <span style={chip("#eaf3eb", GREEN)}>ใช้</span> : <span style={chip("#f2ebdd", MUTED)}>ปิด</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
