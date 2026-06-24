// Playland · หลังบ้าน Dashboard — เนื้อหา/การสื่อสารจากดีไซน์ Admin (KPI · กราฟ · ต้องลงมือ · ต่อสาขา)
// แต่อยู่ในเมนูเดิม (AdminShell) + พื้นขาว + สไตล์ Play a lot เดิม (CEO 2026-06-24)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandAccess, requirePlaylandManager, canPlaylandManage } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getTodayStats } from "@/lib/playland/queries";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb } from "@/lib/playland/format";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { DemoSeedButton } from "@/components/playland/demo-seed-button";
import { PackageX, Clock, ScanFace, ChevronRight, FileBarChart2, Store, Coins } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const dayKey = (d: Date | string) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10); };
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function PlaylandDashboard() {
  const session = await requireSession();
  requirePlaylandAccess(session.user.role);
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId);

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const ago14 = new Date(todayStart); ago14.setDate(ago14.getDate() - 13);
  const yKey = dayKey(new Date(todayStart.getTime() - 86400000));
  const tKey = dayKey(todayStart);

  const [stats, newMembers, sales14, topLines, lowRows, openShifts, devOffline, sessByBranch, varShifts] = await Promise.all([
    getTodayStats(orgId),
    prisma.playlandMember.count({ where: { orgId, createdAt: { gte: todayStart } } }),
    prisma.playlandSale.findMany({ where: { orgId, voidedAt: null, soldAt: { gte: ago14 } }, select: { soldAt: true, totalCents: true, branchId: true, _count: { select: { lines: true } } } }),
    prisma.playlandSaleLine.groupBy({ by: ["productName"], where: { sale: { orgId, voidedAt: null, soldAt: { gte: todayStart } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 5 }),
    prisma.playlandProduct.findMany({ where: { orgId, active: true, reorderLevel: { gt: 0 } }, select: { stock: true, reorderLevel: true, name: true } }),
    prisma.playlandShift.findMany({ where: { orgId, status: "OPEN" }, select: { branchId: true, startedAt: true } }),
    prisma.playlandDevice.count({ where: { orgId, status: { in: ["OFFLINE", "ERROR"] } } }),
    prisma.playlandSession.groupBy({ by: ["branchId"], where: { orgId, checkInAt: { gte: todayStart } }, _count: { _all: true } }),
    prisma.playlandShift.findMany({ where: { orgId, status: "CLOSED", endedAt: { gte: todayStart } }, select: { varianceCents: true } }),
  ]);
  const offShiftCount = varShifts.filter((s) => (s.varianceCents ?? 0) !== 0).length;

  const days: string[] = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(todayStart); d.setDate(d.getDate() - i); days.push(dayKey(d)); }
  const dayMap = new Map(days.map((k) => [k, { entry: 0, product: 0 }]));
  const perBranch = new Map<string, { entry: number; product: number; sessions: number }>();
  for (const b of branches) perBranch.set(b.id, { entry: 0, product: 0, sessions: 0 });
  for (const s of sales14) {
    const k = dayKey(s.soldAt);
    const bucket = dayMap.get(k);
    if (bucket) { if (s._count.lines > 0) bucket.product += s.totalCents; else bucket.entry += s.totalCents; }
    if (k === tKey) { const x = perBranch.get(s.branchId); if (x) { if (s._count.lines > 0) x.product += s.totalCents; else x.entry += s.totalCents; } }
  }
  for (const sc of sessByBranch) { const x = perBranch.get(sc.branchId); if (x) x.sessions = sc._count._all; }
  const series = days.map((k) => dayMap.get(k)!);
  const maxDay = Math.max(1, ...series.map((d) => d.entry + d.product));
  const yRevenue = (dayMap.get(yKey)?.entry ?? 0) + (dayMap.get(yKey)?.product ?? 0);
  const revDelta = yRevenue > 0 ? Math.round(((stats.totalRevenueCents - yRevenue) / yRevenue) * 100) : null;

  const avgBill = stats.salesCount > 0 ? Math.round(stats.totalRevenueCents / stats.salesCount) : 0;
  const low = lowRows.filter((p) => p.stock <= p.reorderLevel);
  const maxTop = Math.max(1, ...topLines.map((t) => t._sum.quantity ?? 0));
  const oldestShiftHrs = openShifts.length > 0 ? Math.floor((Date.now() - Math.min(...openShifts.map((s) => new Date(s.startedAt).getTime()))) / 3600000) : 0;
  const subtitle = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "short", year: "numeric" }) + " · อัปเดตเรียลไทม์";

  const kpis = [
    { label: "รายได้รวม", value: thb(stats.totalRevenueCents), sub: revDelta != null ? `${revDelta >= 0 ? "▲" : "▼"} ${Math.abs(revDelta)}% · ${stats.salesCount} บิล` : `${stats.salesCount} บิล`, subColor: revDelta != null && revDelta >= 0 ? GREEN : revDelta != null ? RED : MUTED },
    { label: "ค่าเข้า · เวลา", value: thb(stats.entryRevenueCents), sub: `${stats.sessionsToday} sessions`, subColor: MUTED },
    { label: "ขายของ", value: thb(stats.productRevenueCents), sub: `${stats.salesCount} รายการ`, subColor: MUTED },
    { label: "สมาชิกใหม่", value: String(newMembers), sub: `กำลังเล่น ${stats.activeSessions}`, subColor: MUTED },
  ];

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip — title + ตัวสลับสาขา(ด้านบน) + หน้าร้าน */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA }}>ภาพรวมร้าน</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {canPlaylandManage(session.user.role) && activeId && <DemoSeedButton branchId={activeId} />}
          <Link href="/playland/reports" style={btn(false)}><FileBarChart2 size={15} /> รายงาน</Link>
          <BranchSwitcher branches={branches} activeId={activeId} />
          <Link href="/playland" style={btn(true)}><Store size={15} /> หน้าร้าน <ChevronRight size={14} /></Link>
        </div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 32px 40px" }}>
        {/* KPI row */}
        <div className="pl-kpi-row" style={{ marginBottom: 18 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24 }}>{k.value}</div>
              <div style={{ fontSize: 12, color: k.subColor, marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
          <div style={{ background: BLUE, borderRadius: 16, padding: 18, color: "#fff" }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>บิลเฉลี่ย</div>
            <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24 }}>{thb(avgBill)}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{stats.salesCount} บิลวันนี้</div>
          </div>
        </div>

        {/* chart + alerts */}
        <div className="pl-grid-2" style={{ marginBottom: 18 }}>
          <div style={{ ...card, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 600, fontSize: 16, flex: 1, fontFamily: FREDOKA }}>รายได้ 14 วันล่าสุด</div>
              <div style={{ display: "flex", gap: 14, fontSize: 12, color: MUTED }}><span style={{ color: BLUE }}>● ค่าเข้า</span><span style={{ color: AMBER }}>● ขายของ</span></div>
            </div>
            <div style={{ height: 220, display: "flex", alignItems: "flex-end", gap: 9 }}>
              {series.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, height: "100%" }} title={`${days[i].slice(5)} · ${thb(d.entry + d.product)}`}>
                  <div style={{ height: `${(d.entry / maxDay) * 100}%`, background: BLUE, borderRadius: "5px 5px 0 0", minHeight: d.entry > 0 ? 2 : 0 }} />
                  <div style={{ height: `${(d.product / maxDay) * 100}%`, background: AMBER, borderRadius: "0 0 5px 5px", minHeight: d.product > 0 ? 2 : 0 }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 600, fontSize: 16, fontFamily: FREDOKA }}>ต้องลงมือ</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>รายการที่รอจัดการ</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {offShiftCount > 0 && (
                <Link href="/playland/reports" style={alertRow("#fdeceb")}>
                  <div style={alertIco}><Coins size={17} color={RED} /></div>
                  <div style={{ flex: 1 }}><div style={alertT}>เงินกะไม่ตรง {offShiftCount} กะวันนี้</div><div style={alertS}>ตรวจนับลิ้นชัก · จับเงินขาด/เกิน</div></div>
                  <ChevronRight size={16} color={RED} />
                </Link>
              )}
              {low.length > 0 && (
                <Link href="/playland/stock" style={alertRow("#fdf3df")}>
                  <div style={alertIco}><PackageX size={17} color={AMBER} /></div>
                  <div style={{ flex: 1 }}><div style={alertT}>ของใกล้หมด {low.length} รายการ</div><div style={alertS}>{low.slice(0, 2).map((p) => p.name).join(" · ")}</div></div>
                  <ChevronRight size={16} color={AMBER} />
                </Link>
              )}
              {openShifts.length > 0 && (
                <Link href="/playland/shifts" style={alertRow("#eaf3f6")}>
                  <div style={alertIco}><Clock size={17} color={BLUE} /></div>
                  <div style={{ flex: 1 }}><div style={alertT}>กะยังไม่ปิด {openShifts.length} กะ</div><div style={alertS}>เปิดมา ~{oldestShiftHrs} ชม.</div></div>
                  <ChevronRight size={16} color="#a89c8b" />
                </Link>
              )}
              {devOffline > 0 && (
                <Link href="/playland/settings/devices" style={alertRow("#fdeceb")}>
                  <div style={alertIco}><ScanFace size={17} color={RED} /></div>
                  <div style={{ flex: 1 }}><div style={alertT}>เครื่องสแกน {devOffline} เครื่องออฟไลน์</div><div style={alertS}>ตรวจสอบประตู</div></div>
                  <ChevronRight size={16} color={RED} />
                </Link>
              )}
              {low.length === 0 && openShifts.length === 0 && devOffline === 0 && offShiftCount === 0 && (
                <div style={{ ...alertRow("#eaf3eb"), cursor: "default" }}><div style={{ flex: 1, ...alertT, color: GREEN }}>✓ ไม่มีรายการค้าง</div></div>
              )}
            </div>
            <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid #f2ebdd` }}>
              <div style={{ fontSize: 13, color: MUTED }}>กำลังเล่นตอนนี้</div>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 20, color: BLUE }}>{stats.activeSessions} คน</div>
            </div>
          </div>
        </div>

        {/* per-branch + top products */}
        <div className="pl-grid-2">
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16, fontFamily: FREDOKA }}>รายได้ต่อสาขา · วันนี้</div>
            <div style={{ display: "flex", fontSize: 12, color: MUTED, padding: "0 4px 10px" }}><div style={{ flex: 2 }}>สาขา</div><div style={{ flex: 1, textAlign: "right" }}>Sessions</div><div style={{ flex: 1, textAlign: "right" }}>ค่าเข้า</div><div style={{ flex: 1, textAlign: "right" }}>ขายของ</div><div style={{ flex: 1, textAlign: "right" }}>รวม</div></div>
            {branches.map((b, i) => {
              const x = perBranch.get(b.id) ?? { entry: 0, product: 0, sessions: 0 };
              const dot = [BLUE, AMBER, GREEN, RED][i % 4];
              return (
                <div key={b.id} style={{ display: "flex", alignItems: "center", padding: "12px 4px", borderTop: `1px solid #f2ebdd` }}>
                  <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} /><span style={{ fontSize: 14 }}>{b.name}</span></div>
                  <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{x.sessions}</div>
                  <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{thb(x.entry)}</div>
                  <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{thb(x.product)}</div>
                  <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontWeight: 600, fontSize: 13 }}>{thb(x.entry + x.product)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16, fontFamily: FREDOKA }}>ขนมขายดี · วันนี้</div>
            {topLines.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีการขายวันนี้</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                {topLines.map((t) => {
                  const q = t._sum.quantity ?? 0;
                  return (
                    <div key={t.productName}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}><span>{t.productName}</span><span style={{ color: MUTED, fontFamily: MONO }}>{q}</span></div>
                      <div style={{ height: 7, background: "#f2ebdd", borderRadius: 99 }}><div style={{ width: `${(q / maxTop) * 100}%`, height: "100%", background: AMBER, borderRadius: 99 }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600,
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}
const alertRow = (bg: string): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 11, background: bg, textDecoration: "none", color: INK });
const alertIco: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const alertT: React.CSSProperties = { fontSize: 14, fontWeight: 500 };
const alertS: React.CSSProperties = { fontSize: 12, color: MUTED };
