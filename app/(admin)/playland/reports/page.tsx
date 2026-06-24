import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb, thbShort, fmtDate, fmtDateTime } from "@/lib/playland/format";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { BarChart3, Download, Users, Clock, Coins } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "รายงาน · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const CAT_COLORS = [BLUE, AMBER, GREEN, "#9B59B6", "#E67E22", "#16A085", RED, MUTED];

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
  const [sales, sessions, members, saleLines, shifts] = await Promise.all([
    // เงินทั้งหมดมาจาก "รายการขายจริง" (ค่าเข้า/ต่อเวลา/ค่าปรับ = ไม่มีรายการสินค้า · ขายของ = มีรายการสินค้า)
    prisma.playlandSale.findMany({ where, select: { totalCents: true, branchId: true, soldAt: true, paymentMethod: true, _count: { select: { lines: true } } } }),
    prisma.playlandSession.findMany({
      where: { orgId, checkInAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
      // นับ session/แขก + เด็ก/ผู้ใหญ่ + ชั่วโมงพีค (ไม่คิดเงินจากตรงนี้ = กันนับค่าเข้าซ้ำ)
      select: { branchId: true, status: true, memberId: true, checkInAt: true, member: { select: { type: true } } },
    }),
    prisma.playlandMember.count({ where: { orgId, createdAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) } }),
    // ขายแยกหมวด: รายการสินค้า join หมวด
    prisma.playlandSaleLine.findMany({ where: { sale: where }, select: { lineCents: true, product: { select: { category: true } } } }),
    // ปิดวัน/นับลิ้นชัก: กะในช่วงนี้ (variance = ขาด/เกินเงินสด · server คิดจากเงินสดอย่างเดียวแล้ว)
    prisma.playlandShift.findMany({
      where: { orgId, ...(branchId ? { branchId } : {}), startedAt: { gte: from, lte: to } },
      orderBy: { startedAt: "desc" },
      select: { shiftCode: true, openingCashCents: true, expectedCashCents: true, closingCashCents: true, varianceCents: true, status: true, startedAt: true, endedAt: true, isDayClose: true },
    }),
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

  // ── เด็ก vs ผู้ใหญ่ (distinct คน ตามประเภทสมาชิก) ──
  const kidSet = new Set<string>(), adultSet = new Set<string>(), otherSet = new Set<string>();
  for (const s of sessions) {
    const t = s.member?.type;
    if (t === "KID") kidSet.add(s.memberId);
    else if (t === "PARENT") adultSet.add(s.memberId);
    else otherSet.add(s.memberId);
  }
  const kids = kidSet.size, adults = adultSet.size, otherGuests = otherSet.size;
  const kidPerAdult = adults > 0 ? (kids / adults) : 0;

  // ── ชั่วโมงคนเยอะ (peak hour) จาก check-in ──
  const hourBuckets = new Array(24).fill(0) as number[];
  for (const s of sessions) hourBuckets[new Date(s.checkInAt).getHours()]++;
  const peakHour = hourBuckets.some((c) => c > 0) ? hourBuckets.indexOf(Math.max(...hourBuckets)) : -1;
  const activeIdx = hourBuckets.map((c, h) => ({ c, h })).filter((x) => x.c > 0).map((x) => x.h);
  const firstH = activeIdx.length ? Math.min(...activeIdx) : 9;
  const lastH = activeIdx.length ? Math.max(...activeIdx) : 20;
  const hourRange: number[] = [];
  for (let h = firstH; h <= lastH; h++) hourRange.push(h);
  const maxHourCount = Math.max(1, ...hourBuckets);

  // ── รายได้แยกหมวด (ค่าเข้า·เวลา + หมวดสินค้า) ──
  const catMap = new Map<string, number>();
  if (totalEntry > 0) catMap.set("ค่าเข้า · เวลา", totalEntry);
  for (const l of saleLines) {
    const cat = l.product?.category?.trim() || "อื่น ๆ";
    catMap.set(cat, (catMap.get(cat) ?? 0) + l.lineCents);
  }
  const catRows = [...catMap.entries()].filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  const catTotal = catRows.reduce((m, [, v]) => m + v, 0) || 1;

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

  // ── ปิดวัน: ยอดรวม ขาด/เกิน ของกะที่ปิดแล้ว ──
  const closedShifts = shifts.filter((sh) => sh.status === "CLOSED");
  const openShiftCount = shifts.length - closedShifts.length;
  const totalVariance = closedShifts.reduce((m, sh) => m + (sh.varianceCents ?? 0), 0);
  const offShifts = closedShifts.filter((sh) => (sh.varianceCents ?? 0) !== 0).length;

  const exportUrl = `/api/playland/reports/export?${new URLSearchParams({ ...(branchId && { branch: branchId }), from: from.toISOString(), to: to.toISOString() }).toString()}`;
  const subtitle = `${fmtDate(from)} – ${fmtDate(to)} · สรุปยอด/ปิดวัน`;

  const kpis = [
    { label: "รายได้รวม", value: thb(total), sub: `${sales.length} บิล`, hero: true },
    { label: "ค่าเข้า · เวลา", value: thbShort(totalEntry), sub: `${sessions.length} sessions`, hero: false },
    { label: "ขายของ", value: thbShort(totalProducts), sub: `${sales.length} bills`, hero: false },
    { label: "ผู้เล่นไม่ซ้ำ", value: String(uniqueMembers), sub: `สมาชิกใหม่ ${members}`, hero: false },
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

        {/* ผู้เล่น เด็ก/ผู้ใหญ่ + ชั่วโมงคนเยอะ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.9fr", gap: 16, marginBottom: 18 }}>
          {/* เด็ก vs ผู้ใหญ่ */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Users size={17} color={BLUE} />
              <div style={{ fontWeight: 600, fontSize: 16, fontFamily: FREDOKA }}>ผู้เล่นวันนี้</div>
            </div>
            {uniqueMembers === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีผู้เล่นในช่วงนี้</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1, background: "#fdf3df", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, color: AMBER }}>เด็ก</div>
                    <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: AMBER }}>{kids}</div>
                  </div>
                  <div style={{ flex: 1, background: "#eaf3f6", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, color: BLUE }}>ผู้ใหญ่</div>
                    <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: BLUE }}>{adults}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid #f2ebdd`, fontSize: 13, color: MUTED, display: "flex", justifyContent: "space-between" }}>
                  <span>อัตรา เด็ก/ผู้ใหญ่</span>
                  <strong style={{ fontFamily: MONO, color: INK }}>{kidPerAdult > 0 ? `${kidPerAdult.toFixed(1)} : 1` : "—"}</strong>
                </div>
                {otherGuests > 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>อื่น ๆ (VIP/แขก) {otherGuests} คน</div>}
              </>
            )}
          </div>

          {/* ชั่วโมงคนเยอะ */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Clock size={17} color={BLUE} />
              <div style={{ fontWeight: 600, fontSize: 16, fontFamily: FREDOKA }}>ชั่วโมงคนเยอะ</div>
            </div>
            {peakHour < 0 ? (
              <div style={{ color: MUTED, fontSize: 14, padding: "24px 0", textAlign: "center" }}>ยังไม่มีคนเข้าเล่นในช่วงนี้</div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>
                  คนเยอะสุด <strong style={{ color: RED, fontFamily: MONO }}>{String(peakHour).padStart(2, "0")}:00–{String(peakHour + 1).padStart(2, "0")}:00</strong> ({hourBuckets[peakHour]} คน) · เผื่อจัดพนักงาน/โปร
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 130 }}>
                  {hourRange.map((h) => {
                    const c = hourBuckets[h];
                    const isPeak = h === peakHour;
                    return (
                      <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }} title={`${String(h).padStart(2, "0")}:00 · ${c} คน`}>
                        <div style={{ fontSize: 10, fontFamily: MONO, color: isPeak ? RED : MUTED }}>{c || ""}</div>
                        <div style={{ width: "100%", height: `${(c / maxHourCount) * 100}%`, minHeight: c > 0 ? 3 : 0, background: isPeak ? RED : BLUE, borderRadius: "4px 4px 0 0" }} />
                        <div style={{ fontSize: 10, fontFamily: MONO, color: MUTED }}>{String(h).padStart(2, "0")}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* วิธีรับเงิน + รายได้แยกหมวด */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
          {/* วิธีรับเงิน */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12, fontFamily: FREDOKA }}>วิธีรับเงิน</div>
            {total === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีรายรับในช่วงนี้</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ flex: "1 1 160px", background: "#eaf3eb", borderRadius: 12, padding: "12px 16px" }}>
                    <div style={{ fontSize: 12, color: GREEN }}>เงินสด (เข้าลิ้นชัก)</div>
                    <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: GREEN }}>{thb(cashTotal)}</div>
                  </div>
                  <div style={{ flex: "1 1 160px", background: "#eaf3f6", borderRadius: 12, padding: "12px 16px" }}>
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

          {/* รายได้แยกหมวด */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 14, fontFamily: FREDOKA }}>รายได้แยกหมวด</div>
            {catRows.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีรายได้ในช่วงนี้</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {catRows.map(([cat, v], i) => {
                  const pct = Math.round((v / catTotal) * 100);
                  const color = CAT_COLORS[i % CAT_COLORS.length];
                  return (
                    <div key={cat}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />{cat}</span>
                        <span><strong style={{ fontFamily: MONO }}>{thb(v)}</strong> <span style={{ color: MUTED, fontFamily: MONO }}>{pct}%</span></span>
                      </div>
                      <div style={{ height: 7, background: "#f2ebdd", borderRadius: 99 }}><div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99 }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
              const dot = [BLUE, AMBER, GREEN, RED][i % 4];
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

        {/* ใบปิดวัน · นับลิ้นชัก (variance จริง) */}
        <div style={{ ...card, padding: 22, marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <Coins size={17} color={GREEN} />
            <div style={{ fontWeight: 600, fontSize: 16, fontFamily: FREDOKA }}>ใบปิดวัน · นับลิ้นชัก</div>
            <a href={exportUrl} style={{ ...btn(true), marginLeft: "auto" }}><Download size={15} /> CSV</a>
          </div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>
            กะที่ปิดแล้ว {closedShifts.length} กะ{openShiftCount > 0 ? ` · ยังเปิดอยู่ ${openShiftCount} กะ` : ""} ·
            {offShifts === 0
              ? <strong style={{ color: GREEN }}> เงินตรงทุกกะ ✓</strong>
              : <strong style={{ color: RED }}> เงินไม่ตรง {offShifts} กะ · รวม {totalVariance > 0 ? "เกิน" : "ขาด"} {thb(Math.abs(totalVariance))}</strong>}
          </div>
          {shifts.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 14, padding: "20px 0", textAlign: "center" }}>ยังไม่มีกะในช่วงนี้</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: MUTED, fontWeight: 500, textAlign: "left" }}>
                    <th style={th}>กะ</th>
                    <th style={th}>เปิด–ปิด</th>
                    <th style={{ ...th, textAlign: "right" }}>เงินต้นกะ</th>
                    <th style={{ ...th, textAlign: "right" }}>ควรมี (เงินสด)</th>
                    <th style={{ ...th, textAlign: "right" }}>นับจริง</th>
                    <th style={{ ...th, textAlign: "right" }}>ขาด/เกิน</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((sh) => {
                    const open = sh.status !== "CLOSED";
                    const v = sh.varianceCents;
                    const vColor = open ? MUTED : v === 0 || v == null ? GREEN : RED;
                    return (
                      <tr key={sh.shiftCode} style={{ borderTop: `1px solid #f2ebdd` }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600, fontFamily: MONO }}>{sh.shiftCode}</div>
                          {sh.isDayClose && <span style={badge(BLUE, "#eaf3f6")}>ปิดวัน</span>}
                          {open && <span style={badge(GREEN, "#eaf3eb")}>เปิดอยู่</span>}
                        </td>
                        <td style={{ ...td, color: MUTED, whiteSpace: "nowrap" }}>{fmtDateTime(sh.startedAt.toISOString())}{sh.endedAt ? ` – ${fmtDateTime(sh.endedAt.toISOString()).slice(-5)}` : ""}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>{thb(sh.openingCashCents)}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>{sh.expectedCashCents != null ? thb(sh.expectedCashCents) : "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>{sh.closingCashCents != null ? thb(sh.closingCashCents) : "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: MONO, fontWeight: 700, color: vColor }}>
                          {open || v == null ? "—" : v === 0 ? "ตรง" : `${v > 0 ? "เกิน " : "ขาด "}${thb(Math.abs(v))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const dateInput: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 9, padding: "7px 10px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none" };
const th: React.CSSProperties = { padding: "9px 12px", fontWeight: 500, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "11px 12px", verticalAlign: "top" };
const badge = (color: string, bg: string): React.CSSProperties => ({ display: "inline-block", marginTop: 4, marginRight: 4, fontSize: 11, fontWeight: 600, color, background: bg, borderRadius: 999, padding: "2px 9px" });
function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}
