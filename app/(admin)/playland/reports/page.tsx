import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { thb, fmtDate } from "@/lib/playland/format";
import { BarChart3, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ branch?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || "";

  const to = sp.to ? new Date(sp.to) : new Date();
  to.setHours(23, 59, 59, 999);
  const from = sp.from ? new Date(sp.from) : new Date(to.getTime() - 7 * 24 * 60 * 60_000);
  from.setHours(0, 0, 0, 0);

  // Per-branch rollup
  const where = { orgId, soldAt: { gte: from, lte: to }, voidedAt: null, ...(branchId ? { branchId } : {}) };
  const [sales, sessions, members] = await Promise.all([
    prisma.playlandSale.findMany({
      where,
      select: { totalCents: true, branchId: true, soldAt: true },
    }),
    prisma.playlandSession.findMany({
      where: { orgId, checkInAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
      select: { packagePriceCents: true, branchId: true, status: true, memberId: true, checkInAt: true },
    }),
    prisma.playlandMember.count({ where: { orgId, createdAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) } }),
  ]);

  const totalEntry = sessions.reduce((a, s) => a + s.packagePriceCents, 0);
  const totalProducts = sales.reduce((a, s) => a + s.totalCents, 0);
  const total = totalEntry + totalProducts;
  const uniqueMembers = new Set(sessions.map((s) => s.memberId)).size;

  // per-branch breakdown
  const perBranch = new Map<string, { entry: number; product: number; sessions: number }>();
  for (const b of branches) perBranch.set(b.id, { entry: 0, product: 0, sessions: 0 });
  for (const s of sessions) {
    const x = perBranch.get(s.branchId) ?? { entry: 0, product: 0, sessions: 0 };
    x.entry += s.packagePriceCents;
    x.sessions += 1;
    perBranch.set(s.branchId, x);
  }
  for (const s of sales) {
    const x = perBranch.get(s.branchId) ?? { entry: 0, product: 0, sessions: 0 };
    x.product += s.totalCents;
    perBranch.set(s.branchId, x);
  }

  // per-day breakdown
  const dayMap = new Map<string, { entry: number; product: number }>();
  for (const s of sessions) {
    const day = new Date(s.checkInAt).toISOString().slice(0, 10);
    const x = dayMap.get(day) ?? { entry: 0, product: 0 };
    x.entry += s.packagePriceCents;
    dayMap.set(day, x);
  }
  for (const s of sales) {
    const day = new Date(s.soldAt).toISOString().slice(0, 10);
    const x = dayMap.get(day) ?? { entry: 0, product: 0 };
    x.product += s.totalCents;
    dayMap.set(day, x);
  }
  const days = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · รายงาน</div>
          <h1>{fmtDate(from)} — {fmtDate(to)}</h1>
        </div>
        <form style={{ display: "flex", gap: 8 }}>
          <select className="pl-select" name="branch" defaultValue={branchId} onChange={(e) => e.currentTarget.form?.submit()} style={{ width: 160 }}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" className="pl-input" name="from" defaultValue={from.toISOString().slice(0, 10)} style={{ width: 140 }} />
          <input type="date" className="pl-input" name="to" defaultValue={to.toISOString().slice(0, 10)} style={{ width: 140 }} />
          <button className="pl-btn pl-btn-primary">ดู</button>
          <Link href={`/api/playland/reports/export?${new URLSearchParams({ ...(branchId && { branch: branchId }), from: from.toISOString(), to: to.toISOString() }).toString()}`} className="pl-btn"><Download size={14} /> CSV</Link>
        </form>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <div className="pl-card pl-stat"><span className="pl-stat-label">รายได้รวม</span><span className="pl-stat-value">{thb(total)}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">ค่าเข้า</span><span className="pl-stat-value">{thb(totalEntry)}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">ขายของ</span><span className="pl-stat-value">{thb(totalProducts)}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">Sessions</span><span className="pl-stat-value">{sessions.length}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">สมาชิกใหม่</span><span className="pl-stat-value">{members}</span></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 16px 16px", overflow: "auto" }}>
        <div className="pl-card">
          <div className="pl-eyebrow" style={{ marginBottom: 8 }}>per สาขา</div>
          <table className="pl-table">
            <thead><tr><th>สาขา</th><th>Sessions</th><th>ค่าเข้า</th><th>ขายของ</th><th>รวม</th></tr></thead>
            <tbody>
              {branches.map((b) => {
                const x = perBranch.get(b.id) ?? { entry: 0, product: 0, sessions: 0 };
                return (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{x.sessions}</td>
                    <td>{thb(x.entry)}</td>
                    <td>{thb(x.product)}</td>
                    <td style={{ fontWeight: 600 }}>{thb(x.entry + x.product)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="pl-card">
          <div className="pl-eyebrow" style={{ marginBottom: 8 }}>per วัน</div>
          <table className="pl-table">
            <thead><tr><th>วันที่</th><th>ค่าเข้า</th><th>ขายของ</th><th>รวม</th></tr></thead>
            <tbody>
              {days.length === 0 ? <tr><td colSpan={4}><div className="pl-empty"><BarChart3 size={28} opacity={0.4} />ไม่มีข้อมูล</div></td></tr> :
                days.map(([d, v]) => (
                  <tr key={d}>
                    <td>{d}</td>
                    <td>{thb(v.entry)}</td>
                    <td>{thb(v.product)}</td>
                    <td style={{ fontWeight: 600 }}>{thb(v.entry + v.product)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
