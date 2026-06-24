import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
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
  requirePlaylandManager(session.user.role); // รายงานยอด/PII = ผู้จัดการขึ้นไป (กันพนักงานเห็นรายได้รวม)
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || "";

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
        <div className="pl-mobile-stats" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 20 }}>
          <div className="pl-card pl-card-accent pl-stat-hero">
            <span className="pl-stat-label">รายได้รวม</span>
            <span className="pl-stat-value">{thb(total)}</span>
            <span className="pl-stat-delta">{sessions.length + sales.length} transactions</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">ค่าเข้า · เวลา</span>
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

        {/* วิธีรับเงิน — เงินสดเข้าลิ้นชัก · ที่เหลือเข้าบัญชี/ออนไลน์ */}
        <div className="pl-card" style={{ marginBottom: 20 }}>
          <div className="pl-eyebrow" style={{ marginBottom: 10 }}>วิธีรับเงิน</div>
          {total === 0 ? (
            <div style={{ color: "var(--pl-text-muted)", fontSize: 14 }}>ยังไม่มีรายรับในช่วงนี้</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ flex: "1 1 180px", background: "var(--pl-ok-soft)", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "var(--pl-ok-ink)" }}>💵 เงินสด (เข้าลิ้นชัก)</div>
                  <div className="pl-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--pl-ok-ink)" }}>{thb(cashTotal)}</div>
                </div>
                <div style={{ flex: "1 1 180px", background: "var(--pl-info-soft)", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "var(--pl-info-ink)" }}>🏦 ไม่ใช่เงินสด (เข้าบัญชี/ออนไลน์)</div>
                  <div className="pl-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--pl-info-ink)" }}>{thb(nonCashTotal)}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {methodRows.map(([m, v]) => (
                  <span key={m} className="pl-chip pl-chip-muted" style={{ fontSize: 13 }}>{METHOD_LABEL[m] ?? m}: <strong style={{ marginLeft: 4 }}>{thb(v)}</strong></span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="pl-mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
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
