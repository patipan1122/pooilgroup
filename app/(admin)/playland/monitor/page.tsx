// Playland · Live Monitor
// Two modes:
//   default · dashboard view (in admin shell · for cashier/manager polling)
//   ?tv=1   · cinema TV mode (jumbo screen behind counter · public can see)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, getUnreadAlerts, getTodayStats, listBranches } from "@/lib/playland/queries";
import { fmtTime, fmtElapsed, sessionStatusLabel, thb, thbShort, memberTypeLabel } from "@/lib/playland/format";
import { MonitorTickClient } from "@/components/playland/monitor-tick-client";
import { NavSelect } from "@/components/playland/nav-select";
import { Tv, ArrowLeft, Smile, Bell } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ tv?: string; branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  const isTV = sp.tv === "1";

  const [activeSessions, alerts, stats] = await Promise.all([
    getActiveSessions(orgId, branchId),
    getUnreadAlerts(orgId, branchId),
    getTodayStats(orgId, branchId),
  ]);

  // ╭───────────────────────────────────────────╮
  // │  TV MODE · cinema dark · public-facing    │
  // ╰───────────────────────────────────────────╯
  if (isTV) {
    const branchName = branches.find((b) => b.id === branchId)?.name ?? "Playland";
    return (
      <div className="pl-tv">
        <MonitorTickClient />
        <div className="pl-tv-header">
          <div>
            <div className="pl-tv-meta">PLAYLAND · LIVE · {branchName}</div>
            <h1 className="pl-tv-title">
              คนในร้านตอนนี้ · {activeSessions.length} คน
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="pl-tv-meta" style={{ marginBottom: 4 }}>วันนี้</div>
            <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "2rem", fontWeight: 500, letterSpacing: "-0.02em", color: "#fed7aa" }}>
              {thbShort(stats.totalRevenueCents)}
            </div>
          </div>
        </div>

        {activeSessions.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", height: "60vh", color: "rgba(255, 255, 255, 0.4)" }}>
            <Smile size={72} opacity={0.3} />
            <div style={{ marginTop: 16, fontFamily: "var(--pl-font-display)", fontSize: "1.4rem" }}>ยังไม่มีใครเล่นในร้าน</div>
          </div>
        ) : (
          <div className="pl-tv-grid pl-stagger">
            {activeSessions.map((s) => {
              const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
              const remainMin = remainingMs ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
              const warn = remainMin !== null && remainMin < 10;
              const danger = remainMin !== null && remainMin <= 0;
              return (
                <div key={s.id} className={`pl-tv-card${danger ? " is-danger" : warn ? " is-warn" : ""}`}>
                  {s.member.photoR2Path ? (
                    <img src={s.member.photoR2Path} alt="" className="pl-tv-avatar" />
                  ) : (
                    <div className="pl-tv-avatar">{(s.member.nickname ?? s.member.name)[0]}</div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="pl-tv-name">{s.member.nickname ?? s.member.name}</div>
                    <div className="pl-tv-meta-line">{s.package?.name ?? "—"}</div>
                    <div className={`pl-tv-time${danger ? " is-danger" : warn ? " is-warn" : ""}`} data-expires-at={s.expiresAt?.toISOString() ?? ""}>
                      {s.packageMinutes === 0 ? "∞" : remainMin !== null ? `${remainMin} นาที` : "—"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ╭───────────────────────────────────────────╮
  // │  DASHBOARD MODE · in-app polling view     │
  // ╰───────────────────────────────────────────╯
  return (
    <div className="pl-page">
      <MonitorTickClient />
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> กลับ Workspace</Link>
          <h1>Live Monitor</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {branches.length > 1 && <NavSelect param="branch" value={branchId ?? ""} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 170 }} />}
          <Link href={`/playland/monitor?tv=1&branch=${branchId}`} className="pl-btn pl-btn-primary"><Tv size={14} /> TV mode</Link>
        </div>
      </header>

      {/* Hero stats inline · dense · numbers are heroes */}
      <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, borderBottom: "1px solid var(--pl-line)", background: "var(--pl-paper)" }}>
        <div className="pl-stat">
          <span className="pl-stat-label">ในร้านตอนนี้</span>
          <span className="pl-stat-value">{stats.activeSessions}</span>
        </div>
        <div className="pl-stat">
          <span className="pl-stat-label">วันนี้รวม</span>
          <span className="pl-stat-value">{stats.sessionsToday}</span>
        </div>
        <div className="pl-stat">
          <span className="pl-stat-label">หมดเวลา</span>
          <span className="pl-stat-value" style={{ color: stats.expiredSessions > 0 ? "var(--pl-warn)" : undefined }}>{stats.expiredSessions}</span>
        </div>
        <div className="pl-stat">
          <span className="pl-stat-label">รายได้วันนี้</span>
          <span className="pl-stat-value">{thbShort(stats.totalRevenueCents)}</span>
        </div>
        <div className="pl-stat">
          <span className="pl-stat-label">จองวันนี้</span>
          <span className="pl-stat-value">{stats.bookingsToday}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "calc(100% - 130px)" }}>
        <div className="pl-pane" style={{ overflowY: "auto" }}>
          <table className="pl-table">
            <thead>
              <tr>
                <th>สมาชิก</th>
                <th>ประเภท</th>
                <th>แพคเกจ</th>
                <th>เข้า</th>
                <th>เวลาเล่น</th>
                <th>คงเหลือ</th>
              </tr>
            </thead>
            <tbody className="pl-stagger">
              {activeSessions.length === 0 ? (
                <tr><td colSpan={6}><div className="pl-empty"><div className="pl-empty-icon"><Smile size={22} /></div><div className="pl-empty-title">ไม่มีใครเล่น</div><div className="pl-empty-message">รายชื่อจะ live ขึ้นที่นี่</div></div></td></tr>
              ) : activeSessions.map((s) => {
                const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
                const remainMin = remainingMs !== null ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
                const danger = remainMin !== null && remainMin <= 0;
                const warn = remainMin !== null && remainMin < 10;
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.member.nickname ?? s.member.name}</div>
                      <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)" }}>{s.member.memberCode ?? "—"}</div>
                    </td>
                    <td><span className="pl-chip pl-chip-brand">{memberTypeLabel(s.member.type)}</span></td>
                    <td>{s.package?.name ?? "—"}</td>
                    <td className="pl-num">{fmtTime(s.checkInAt)}</td>
                    <td className="pl-num" style={{ color: "var(--pl-text-muted)" }}>{fmtElapsed(s.checkInAt)}</td>
                    <td>
                      <span className={`pl-countdown${danger ? " is-danger" : warn ? " is-warn" : ""}`} data-expires-at={s.expiresAt?.toISOString() ?? ""}>
                        {s.packageMinutes === 0 ? "∞" : remainMin !== null ? `${remainMin}น` : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="pl-pane">
          <div className="pl-pane-head">
            <div>
              <div className="pl-pane-title">แจ้งเตือน</div>
              <div className="pl-pane-count">{alerts.length} รายการ</div>
            </div>
          </div>
          {alerts.length === 0 ? (
            <div className="pl-empty">
              <div className="pl-empty-icon"><Bell size={22} /></div>
              <div className="pl-empty-title">เงียบ ๆ ดี</div>
            </div>
          ) : (
            <ul className="pl-stagger" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {alerts.map((a) => (
                <li key={a.id} className={`pl-alert is-${a.severity.toLowerCase()}`}>
                  <div className="pl-alert-time">{fmtTime(a.createdAt)} · {a.type.toLowerCase()}</div>
                  <div className="pl-alert-title">{a.title}</div>
                  {a.message && <div className="pl-alert-message">{a.message}</div>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
