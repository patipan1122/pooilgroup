// Playland · หลังบ้าน Dashboard (Direction A · Command) — โครงใหม่ตาม Play a lot Admin.dc.html
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandAccess, requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getTodayStats } from "@/lib/playland/queries";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb, thbShort } from "@/lib/playland/format";
import { OfficeShell } from "@/components/playland/office-shell";
import { PackageX, Clock, ScanFace, ChevronRight, Download } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · Play a lot" };

const INK = "#34291E", MUTED = "#A99C88", BLUE = "#2C6BB3", MUSTARD = "#D9A227", GREEN = "#1F8A5B", RED = "#D9483B", LINE = "#ECE3D4", CREAM = "#F4EEE3";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "'Fredoka', var(--font-fredoka), sans-serif";

const ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", org_admin: "Org Admin", admin: "Admin", program_admin: "Program Admin", area_manager: "Area Manager", branch_manager: "Branch Manager", staff: "พนักงาน", viewer: "Viewer" };
const dayKey = (d: Date | string) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10); };

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

  const [stats, newMembers, sales14, topLines, lowRows, openShifts, devOffline, sessByBranch] = await Promise.all([
    getTodayStats(orgId),
    prisma.playlandMember.count({ where: { orgId, createdAt: { gte: todayStart } } }),
    prisma.playlandSale.findMany({ where: { orgId, voidedAt: null, soldAt: { gte: ago14 } }, select: { soldAt: true, totalCents: true, branchId: true, _count: { select: { lines: true } } } }),
    prisma.playlandSaleLine.groupBy({ by: ["productName"], where: { sale: { orgId, voidedAt: null, soldAt: { gte: todayStart } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 4 }),
    prisma.playlandProduct.findMany({ where: { orgId, active: true, reorderLevel: { gt: 0 } }, select: { stock: true, reorderLevel: true, name: true } }),
    prisma.playlandShift.findMany({ where: { orgId, status: "OPEN" }, select: { branchId: true, startedAt: true } }),
    prisma.playlandDevice.count({ where: { orgId, status: { in: ["OFFLINE", "ERROR"] } } }),
    prisma.playlandSession.groupBy({ by: ["branchId"], where: { orgId, checkInAt: { gte: todayStart } }, _count: { _all: true } }),
  ]);

  // ── 14-day series + yesterday delta ──
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

  const kpis = [
    { label: "รายได้รวม", value: thb(stats.totalRevenueCents), sub: revDelta != null ? `${revDelta >= 0 ? "▲" : "▼"} ${Math.abs(revDelta)}% · ${stats.salesCount} บิล` : `${stats.salesCount} บิล`, subColor: revDelta != null && revDelta >= 0 ? GREEN : revDelta != null ? RED : MUTED },
    { label: "ค่าเข้า · เวลา", value: thb(stats.entryRevenueCents), sub: `${stats.sessionsToday} sessions`, subColor: MUTED },
    { label: "ขายของ", value: thb(stats.productRevenueCents), sub: `${stats.salesCount} รายการ`, subColor: MUTED },
    { label: "สมาชิกใหม่", value: String(newMembers), sub: `กำลังเล่น ${stats.activeSessions}`, subColor: MUTED },
  ];

  const subtitle = new Date().toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + " · อัปเดตเรียลไทม์";

  return (
    <OfficeShell
      branches={branches} activeId={activeId}
      userName={session.user.name || session.user.email || "ผู้ใช้"}
      userRole={ROLE_LABEL[session.user.role] ?? session.user.role}
      title="ภาพรวมร้าน" subtitle={subtitle}
      headerRight={<Link href="/playland/reports" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: MUSTARD, color: "#fff", borderRadius: 9, padding: "8px 16px", fontSize: 13, textDecoration: "none" }}><Download size={14} /> รายงาน</Link>}
    >
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, marginBottom: 18 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", borderRadius: 14, padding: 18, border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24, color: INK }}>{k.value}</div>
            <div style={{ fontSize: 12, color: k.subColor, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
        <div style={{ background: BLUE, borderRadius: 14, padding: 18, color: "#fff" }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>บิลเฉลี่ย</div>
          <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24 }}>{thb(avgBill)}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{stats.salesCount} บิลวันนี้</div>
        </div>
      </div>

      {/* chart + alerts */}
      <div style={{ display: "flex", gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1.7, background: "#fff", borderRadius: 16, border: `1px solid ${LINE}`, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
            <div style={{ fontWeight: 500, fontSize: 16, flex: 1 }}>รายได้ 14 วันล่าสุด</div>
            <div style={{ display: "flex", gap: 14, fontSize: 12, color: MUTED }}><span>● <span style={{ color: BLUE }}>ค่าเข้า</span></span><span>● <span style={{ color: MUSTARD }}>ขายของ</span></span></div>
          </div>
          <div style={{ height: 230, display: "flex", alignItems: "flex-end", gap: 9 }}>
            {series.map((d, i) => {
              const eH = (d.entry / maxDay) * 100, pH = (d.product / maxDay) * 100;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, height: "100%" }} title={`${days[i].slice(5)} · ${thb(d.entry + d.product)}`}>
                  <div style={{ height: `${eH}%`, background: BLUE, borderRadius: "5px 5px 0 0", minHeight: d.entry > 0 ? 2 : 0 }} />
                  <div style={{ height: `${pH}%`, background: MUSTARD, borderRadius: "0 0 5px 5px", minHeight: d.product > 0 ? 2 : 0 }} />
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 1, background: "#fff", borderRadius: 16, border: `1px solid ${LINE}`, padding: 20, display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 4 }}>ต้องลงมือ</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>รายการที่รอจัดการ</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {low.length > 0 && (
              <Link href="/playland/stock" style={alertRow("#FCF1DC")}>
                <div style={alertIco}><PackageX size={17} color={MUSTARD} /></div>
                <div style={{ flex: 1 }}><div style={alertT}>ของใกล้หมด {low.length} รายการ</div><div style={alertS}>{low.slice(0, 2).map((p) => p.name).join(" · ")}</div></div>
                <ChevronRight size={16} color={MUSTARD} />
              </Link>
            )}
            {openShifts.length > 0 && (
              <Link href="/playland/shifts" style={alertRow(CREAM)}>
                <div style={alertIco}><Clock size={17} color={BLUE} /></div>
                <div style={{ flex: 1 }}><div style={alertT}>กะยังไม่ปิด {openShifts.length} กะ</div><div style={alertS}>เปิดมา ~{oldestShiftHrs} ชม.</div></div>
                <ChevronRight size={16} color="#B5A893" />
              </Link>
            )}
            {devOffline > 0 && (
              <Link href="/playland/settings/devices" style={alertRow("#FBEAE7")}>
                <div style={alertIco}><ScanFace size={17} color={RED} /></div>
                <div style={{ flex: 1 }}><div style={alertT}>เครื่องสแกน {devOffline} เครื่องออฟไลน์</div><div style={alertS}>ตรวจสอบประตู</div></div>
                <ChevronRight size={16} color={RED} />
              </Link>
            )}
            {low.length === 0 && openShifts.length === 0 && devOffline === 0 && (
              <div style={{ ...alertRow(CREAM), cursor: "default" }}><div style={alertIco}>✓</div><div style={{ flex: 1, ...alertT }}>ไม่มีรายการค้าง</div></div>
            )}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #F0E8D9" }}>
            <div style={{ fontSize: 13, color: MUTED }}>กำลังเล่นตอนนี้</div>
            <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 20, color: BLUE }}>{stats.activeSessions} คน</div>
          </div>
        </div>
      </div>

      {/* per-branch + top products */}
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1.7, background: "#fff", borderRadius: 16, border: `1px solid ${LINE}`, padding: 22 }}>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 16 }}>รายได้ต่อสาขา · วันนี้</div>
          <div style={{ display: "flex", fontSize: 12, color: MUTED, padding: "0 4px 10px" }}><div style={{ flex: 2 }}>สาขา</div><div style={{ flex: 1, textAlign: "right" }}>Sessions</div><div style={{ flex: 1, textAlign: "right" }}>ค่าเข้า</div><div style={{ flex: 1, textAlign: "right" }}>ขายของ</div><div style={{ flex: 1, textAlign: "right" }}>รวม</div></div>
          {branches.map((b, i) => {
            const x = perBranch.get(b.id) ?? { entry: 0, product: 0, sessions: 0 };
            const dot = [BLUE, MUSTARD, GREEN, RED][i % 4];
            return (
              <div key={b.id} style={{ display: "flex", alignItems: "center", padding: "12px 4px", borderTop: "1px solid #F0E8D9" }}>
                <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} /><span style={{ fontSize: 14 }}>{b.name}</span></div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{x.sessions}</div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{thb(x.entry)}</div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontSize: 13 }}>{thb(x.product)}</div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: MONO, fontWeight: 600, fontSize: 13 }}>{thb(x.entry + x.product)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, background: "#fff", borderRadius: 16, border: `1px solid ${LINE}`, padding: 22 }}>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 16 }}>ขนมขายดี · วันนี้</div>
          {topLines.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีการขายวันนี้</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {topLines.map((t) => {
                const q = t._sum.quantity ?? 0;
                return (
                  <div key={t.productName}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}><span>{t.productName}</span><span style={{ color: MUTED, fontFamily: MONO }}>{q}</span></div>
                    <div style={{ height: 7, background: "#F0E8D9", borderRadius: 99 }}><div style={{ width: `${(q / maxTop) * 100}%`, height: "100%", background: MUSTARD, borderRadius: 99 }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </OfficeShell>
  );
}

const alertRow = (bg: string): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 11, background: bg, textDecoration: "none", color: INK });
const alertIco: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const alertT: React.CSSProperties = { fontSize: 14, fontWeight: 500 };
const alertS: React.CSSProperties = { fontSize: 12, color: MUTED };
