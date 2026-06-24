import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb, thbShort, fmtDate } from "@/lib/playland/format";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { BarChart3, Download } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "รายงาน · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ branch?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role); // รายงานยอด/PII = ผู้จัดการขึ้นไป (กันพนักงานเห็นรายได้รวม)
  const orgId = session.user.org_id;
  // ตัวสลับสาขา = cookie/URL (เหมือนหน้า office) · ?branch= ยังใช้ deep-link ได้
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId ?? "";

  // Default range = today only (per UX review · owner asks "วันนี้เท่าไหร่" not "7 วัน avg")
  const to = sp.to ? new Date(sp.to) : new Date();
  to.setHours(23, 59, 59, 999);
  const from = sp.from ? new Date(sp.from) : new Date(to);
  from.setHours(0, 0, 0, 0);

  const where = { orgId, soldAt: { gte: from, lte: to }, voidedAt: null, ...(branchId ? { branchId } : {}) };
  const [sales, sessions, members] = await Promise.all([
    // เงินทั้งหมดมาจาก "รายการขายจริง" (ค่าเข้า/ต่อเวลา/ค่าปรับ = ไม่มีรายการสินค้า · ขายของ = มีรายการสินค้า)
    prisma.playlandSale.findMany({ where, select: { totalCents: true, branchId: true, soldAt: true, paymentMethod: true, _count: { select: { lines: true } } } }),
    prisma.playlandSession.findMany({
      where: { orgId, checkInAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
      select: { branchId: true, status: true, memberId: true, checkInAt: true }, // นับ session/แขก เท่านั้น (ไม่คิดเงินจากตรงนี้ = กันนับค่าเข้าซ้ำ)
    }),
    prisma.playlandMember.count({ where: { orgId, createdAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) } }),
  ]);

  const isProduct = (s: { _count: { lines: number } }) => s._count.lines > 0;
  let totalEntry = 0;   // ค่าเข้า + ต่อเวลา + ค่าปรับ (รายการไม่มีสินค้า)
  let totalProducts = 0; // ขายขนม/ของ (รายการมีสินค้า)
  const byMethod: Record<string, number> = {};
  for (const s of sales) {
    if (isProduct(s)) totalProducts += s.totalCents; else totalEntry += s.totalCents;
    byMethod[s.paymentMethod] = (byMethod[s.paymentMethod] ?? 0) + s.totalCents;
  }
  const total = totalEntry + totalProducts;
  const uniqueMembers = new Set(sessions.map((s) => s.memberId)).size;

  const perBranch = new Map<string, { entry: number; product: number; sessions: number }>();
  for (const b of branches) perBranch.set(b.id, { entry: 0, product: 0, sessions: 0 });
  for (const s of sessions) {
    const x = perBranch.get(s.branchId) ?? { entry: 0, product: 0, sessions: 0 };
    x.sessions += 1;
    perBranch.set(s.branchId, x);
  }
  for (const s of sales) {
    const x = perBranch.get(s.branchId) ?? { entry: 0, product: 0, sessions: 0 };
    if (isProduct(s)) x.product += s.totalCents; else x.entry += s.totalCents;
    perBranch.set(s.branchId, x);
  }

  const dayMap = new Map<string, { entry: number; product: number }>();
  for (const s of sales) {
    const day = new Date(s.soldAt).toISOString().slice(0, 10);
    const x = dayMap.get(day) ?? { entry: 0, product: 0 };
    if (isProduct(s)) x.product += s.totalCents; else x.entry += s.totalCents;
    dayMap.set(day, x);
  }

  // แยกเงินตามวิธีรับ (ลิ้นชัก = เฉพาะเงินสด · ที่เหลือเข้าบัญชี/ออนไลน์)
  const METHOD_LABEL: Record<string, string> = {
    CASH: "เงินสด", STRIPE: "บัตร/ออนไลน์", PROMPTPAY: "พร้อมเพย์", KBANK: "โอน KBank", SCB: "โอน SCB",
    TRUEMONEY: "ทรูมันนี่", LINEPAY: "LINE Pay", CHARGE_TO_MEMBER: "ค้างจ่าย", COMPLIMENTARY: "ฟรี/อภินันท์",
  };
  const methodRows = Object.entries(byMethod).filter(([, v]) => v !== 0).sort(([, a], [, b]) => b - a);
  const cashTotal = byMethod["CASH"] ?? 0;
  const nonCashTotal = total - cashTotal;
  const days = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  const maxDay = days.reduce((m, [, v]) => Math.max(m, v.entry + v.product), 0);

  const exportUrl = `/api/playland/reports/export?${new URLSearchParams({ ...(branchId && { branch: branchId }), from: from.toISOString(), to: to.toISOString() }).toString()}`;
  const subtitle = `${fmtDate(from)} – ${fmtDate(to)} · สรุปยอด/ปิดวัน`;

  const kpis = [
    { label: "รายได้รวม", value: thb(total), sub: `${sales.length} บิล`, hero: true },
    { label: "ค่าเข้า · เวลา", value: thbShort(totalEntry), sub: `${sessions.length} sessions`, hero: false },
    { label: "ขายของ", value: thbShort(totalProducts), sub: `${sales.length} bills`, hero: false },
    { label: "สมาชิกใหม่", value: String(members), sub: `${uniqueMembers} unique guests`, hero: false },
    { label: "ค่าเฉลี่ย/วัน", value: thbShort(days.length > 0 ? total / days.length : 0), sub: `${days.length} วันมีรายได้`, hero: false },
  ];

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* white header strip — back-office only (ไม่มีสลับหน้าร้าน/หลังบ้าน) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA }}>รายงาน · ปิดวัน</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{subtitle}</div>
        </div>
        <form style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {branchId && <input type="hidden" name="branch" value={branchId} />}
          <input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} style={dateInput} />
          <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} style={dateInput} />
          <button style={btn(false)}>ดู</button>
          <BranchSwitcher branches={branches} activeId={activeId} />
          <a href={exportUrl} style={btn(true)}><Download size={15} /> CSV</a>
        </form>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        {/* KPI row 5-up */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
          {kpis.map((k) => k.hero ? (
            <div key={k.label} style={{ background: BLUE, borderRadius: 16, padding: 18, color: "#fff" }}>
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24 }}>{k.value}</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{k.sub}</div>
            </div>
          ) : (
            <div key={k.label} style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24 }}>{k.value}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* วิธีรับเงิน — เงินสดเข้าลิ้นชัก · ที่เหลือเข้าบัญชี/ออนไลน์ */}
        <div style={{ ...card, padding: 22, marginBottom: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12, fontFamily: FREDOKA }}>วิธีรับเงิน</div>
          {total === 0 ? (
            <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีรายรับในช่วงนี้</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ flex: "1 1 180px", background: "#eaf3eb", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: GREEN }}>เงินสด (เข้าลิ้นชัก)</div>
                  <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: GREEN }}>{thb(cashTotal)}</div>
                </div>
                <div style={{ flex: "1 1 180px", background: "#eaf3f6", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: BLUE }}>ไม่ใช่เงินสด (เข้าบัญชี/ออนไลน์)</div>
                  <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: BLUE }}>{thb(nonCashTotal)}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {methodRows.map(([m, v]) => (
                  <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, background: "#f7f3ea", border: `1px solid ${LINE}`, borderRadius: 999, padding: "5px 12px", color: MUTED }}>
                    {METHOD_LABEL[m] ?? m}: <strong style={{ fontFamily: MONO, color: INK }}>{thb(v)}</strong>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* per-สาขา + per-วัน */}
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16 }}>
          {/* Per-branch */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16, fontFamily: FREDOKA }}>รายได้ต่อสาขา</div>
            <div style={{ display: "flex", fontSize: 12, color: MUTED, padding: "0 4px 10px" }}>
              <div style={{ flex: 2 }}>สาขา</div>
              <div style={{ flex: 1, textAlign: "right" }}>Sessions</div>
              <div style={{ flex: 1, textAlign: "right" }}>ค่าเข้า</div>
              <div style={{ flex: 1, textAlign: "right" }}>ขายของ</div>
              <div style={{ flex: 1, textAlign: "right" }}>รวม</div>
            </div>
            {branches.map((b, i) => {
              const x = perBranch.get(b.id) ?? { entry: 0, product: 0, sessions: 0 };
              const sum = x.entry + x.product;
              const pct = total > 0 ? Math.round((sum / total) * 100) : 0;
              const dot = [BLUE, AMBER, GREEN, "#E74C3C"][i % 4];
              return (
                <div key={b.id} style={{ padding: "12px 4px", borderTop: `1px solid #f2ebdd` }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />
                      <span style={{ fontSize: 14 }}>{b.name}</span>
                    </div>
                    <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{x.sessions}</div>
                    <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{thb(x.entry)}</div>
                    <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{thb(x.product)}</div>
                    <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontWeight: 600, fontSize: 13 }}>{thb(sum)}</div>
                  </div>
                  <div style={{ height: 4, background: "#f2ebdd", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: dot }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-day mini chart */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 16, flex: 1, fontFamily: FREDOKA }}>รายได้ต่อวัน</div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: MUTED }}><span style={{ color: BLUE }}>● ค่าเข้า</span><span style={{ color: AMBER }}>● ขายของ</span></div>
            </div>
            {days.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "30px 0", color: MUTED }}>
                <BarChart3 size={22} />
                <div style={{ fontSize: 14 }}>ไม่มีรายได้ในช่วงนี้</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {days.map(([d, v]) => {
                  const sum = v.entry + v.product;
                  const entryPct = maxDay > 0 ? (v.entry / maxDay) * 100 : 0;
                  const productPct = maxDay > 0 ? (v.product / maxDay) * 100 : 0;
                  return (
                    <div key={d}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ fontFamily: MONO, color: MUTED }}>{d.slice(5)}</span>
                        <span style={{ fontFamily: MONO, fontWeight: 600 }}>{thb(sum)}</span>
                      </div>
                      <div style={{ display: "flex", height: 10, gap: 2, background: "#f2ebdd", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${entryPct}%`, background: BLUE }} title={`ค่าเข้า: ${thb(v.entry)}`} />
                        <div style={{ width: `${productPct}%`, background: AMBER }} title={`ขายของ: ${thb(v.product)}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ใบปิดวัน / สรุปวัน — full width */}
        <div style={{ ...card, padding: 22, marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, fontFamily: FREDOKA }}>ใบปิดวัน · สรุปยอด</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
              รายได้รวมช่วงนี้ <strong style={{ fontFamily: MONO, color: INK }}>{thb(total)}</strong> · เงินสด <strong style={{ fontFamily: MONO, color: GREEN }}>{thb(cashTotal)}</strong> · โอน/ออนไลน์ <strong style={{ fontFamily: MONO, color: BLUE }}>{thb(nonCashTotal)}</strong> · พิมพ์ใบปิดวันด้วย Ctrl+P
            </div>
          </div>
          <a href={exportUrl} style={btn(true)}><Download size={15} /> Download CSV</a>
        </div>
      </div>
    </div>
  );
}

const dateInput: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 9, padding: "7px 10px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none" };
function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}
