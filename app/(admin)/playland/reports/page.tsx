import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { thb, thbShort, fmtDate } from "@/lib/playland/format";
import { BackOfficeTabs } from "@/components/playland/back-office-tabs";
import { NavSelect } from "@/components/playland/nav-select";
import { BarChart3, Download, ArrowLeft, Printer } from "lucide-react";

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

  const where = { orgId, soldAt: { gte: from, lte: to }, voidedAt: null, ...(branchId ? { branchId } : {}) };
  const [sales, sessions, members] = await Promise.all([
    prisma.playlandSale.findMany({ where, select: { totalCents: true, branchId: true, soldAt: true } }),
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

  const perBranch = new Map<string, { entry: number; product: number; sessions: number }>();
  for (const b of branches) perBranch.set(b.id, { entry: 0, product: 0, sessions: 0 });
  for (const s of sessions) {
    const x = perBranch.get(s.branchId) ?? { entry: 0, product: 0, sessions: 0 };
    x.entry += s.packagePriceCents; x.sessions += 1;
    perBranch.set(s.branchId, x);
  }
  for (const s of sales) {
    const x = perBranch.get(s.branchId) ?? { entry: 0, product: 0, sessions: 0 };
    x.product += s.totalCents;
    perBranch.set(s.branchId, x);
  }

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
  const maxDay = days.reduce((m, [, v]) => Math.max(m, v.entry + v.product), 0);

  const exportUrl = `/api/playland/reports/export?${new URLSearchParams({ ...(branchId && { branch: branchId }), from: from.toISOString(), to: to.toISOString() }).toString()}`;

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1>รายงาน · <span style={{ fontFamily: "var(--pl-font-mono)", fontSize: "0.95rem", color: "var(--pl-text-muted)", fontWeight: 400 }}>{fmtDate(from)} – {fmtDate(to)}</span></h1>
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {branches.length > 0 && (
            <select className="pl-select" name="branch" defaultValue={branchId} style={{ width: 150 }}>
              <option value="">ทุกสาขา</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <input type="date" className="pl-input" name="from" defaultValue={from.toISOString().slice(0, 10)} style={{ width: 140 }} />
          <input type="date" className="pl-input" name="to" defaultValue={to.toISOString().slice(0, 10)} style={{ width: 140 }} />
          <button className="pl-btn pl-btn-primary">ดู</button>
          <a href={exportUrl} className="pl-btn"><Download size={14} /> CSV</a>
        </form>
      </header>

      <BackOfficeTabs active="reports" />

      <div style={{ overflowY: "auto", padding: 20 }}>
        {/* Hero stats — numbers are hero */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 20 }}>
          <div className="pl-card pl-card-accent pl-stat-hero">
            <span className="pl-stat-label">รายได้รวม</span>
            <span className="pl-stat-value">{thb(total)}</span>
            <span className="pl-stat-delta">{sessions.length + sales.length} transactions</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">ค่าเข้า</span>
            <span className="pl-stat-value">{thbShort(totalEntry)}</span>
            <span className="pl-stat-delta">{sessions.length} sessions</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">ขายของ</span>
            <span className="pl-stat-value">{thbShort(totalProducts)}</span>
            <span className="pl-stat-delta">{sales.length} bills</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">สมาชิกใหม่</span>
            <span className="pl-stat-value">{members}</span>
            <span className="pl-stat-delta">{uniqueMembers} unique guests</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">ค่าเฉลี่ย/วัน</span>
            <span className="pl-stat-value">{thbShort(days.length > 0 ? total / days.length : 0)}</span>
            <span className="pl-stat-delta">{days.length} วันมีรายได้</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Per-branch */}
          <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--pl-line)" }}>
              <div className="pl-eyebrow">per สาขา</div>
            </div>
            <table className="pl-table">
              <thead><tr><th>สาขา</th><th style={{ textAlign: "right" }}>Sessions</th><th style={{ textAlign: "right" }}>ค่าเข้า</th><th style={{ textAlign: "right" }}>ขายของ</th><th style={{ textAlign: "right" }}>รวม</th></tr></thead>
              <tbody>
                {branches.map((b) => {
                  const x = perBranch.get(b.id) ?? { entry: 0, product: 0, sessions: 0 };
                  const sum = x.entry + x.product;
                  const pct = total > 0 ? Math.round((sum / total) * 100) : 0;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{b.name}</div>
                        <div style={{ height: 4, background: "var(--pl-ink-100)", borderRadius: 4, marginTop: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, var(--pl-amber-400), var(--pl-amber-600))" }} />
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }} className="pl-num">{x.sessions}</td>
                      <td style={{ textAlign: "right" }} className="pl-num">{thb(x.entry)}</td>
                      <td style={{ textAlign: "right" }} className="pl-num">{thb(x.product)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }} className="pl-num">{thb(sum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-day with inline bars */}
          <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--pl-line)" }}>
              <div className="pl-eyebrow">per วัน</div>
            </div>
            {days.length === 0 ? (
              <div className="pl-empty">
                <div className="pl-empty-icon"><BarChart3 size={22} /></div>
                <div className="pl-empty-title">ไม่มีรายได้ในช่วงนี้</div>
              </div>
            ) : (
              <table className="pl-table">
                <thead><tr><th>วัน</th><th>กราฟ</th><th style={{ textAlign: "right" }}>ค่าเข้า</th><th style={{ textAlign: "right" }}>ของ</th><th style={{ textAlign: "right" }}>รวม</th></tr></thead>
                <tbody>
                  {days.map(([d, v]) => {
                    const sum = v.entry + v.product;
                    const entryPct = maxDay > 0 ? (v.entry / maxDay) * 100 : 0;
                    const productPct = maxDay > 0 ? (v.product / maxDay) * 100 : 0;
                    return (
                      <tr key={d}>
                        <td className="pl-num">{d.slice(5)}</td>
                        <td style={{ width: 100 }}>
                          <div style={{ display: "flex", height: 12, gap: 2, background: "var(--pl-ink-50)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${entryPct}%`, background: "var(--pl-amber-500)" }} title={`ค่าเข้า: ${thb(v.entry)}`} />
                            <div style={{ width: `${productPct}%`, background: "var(--pl-indigo-500)" }} title={`ขายของ: ${thb(v.product)}`} />
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }} className="pl-num">{thb(v.entry)}</td>
                        <td style={{ textAlign: "right" }} className="pl-num">{thb(v.product)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }} className="pl-num">{thb(sum)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Daily-close print card */}
        <div className="pl-card" style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="pl-eyebrow"><Printer size={11} /> ใบปิดวัน</div>
            <div style={{ fontSize: 13, color: "var(--pl-text-muted)", marginTop: 4 }}>
              พิมพ์ใบปิดวันสำหรับแฟ้มบัญชี · จะใช้ Ctrl+P browser print
            </div>
          </div>
          <a href={exportUrl} className="pl-btn"><Download size={14} /> Download CSV</a>
        </div>
      </div>
    </div>
  );
}
