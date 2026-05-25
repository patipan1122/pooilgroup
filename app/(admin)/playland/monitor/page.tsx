// Playland · Live Monitor (TV mode + dashboard mode)
// Auto-refreshes every 5 seconds via meta refresh + cache: no-store
// Shows: active sessions with countdown + alerts feed + occupancy

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, getUnreadAlerts, getTodayStats } from "@/lib/playland/queries";
import { fmtTime, fmtElapsed, sessionStatusChipClass, sessionStatusLabel, thbShort, alertSeverityChipClass } from "@/lib/playland/format";
import { Tv, AlertTriangle, Users, Activity, CheckCircle2 } from "lucide-react";
import { MonitorTickClient } from "@/components/playland/monitor-tick-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ tv?: string; branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branchId = sp.branch;
  const isTV = sp.tv === "1";

  const [activeSessions, alerts, stats] = await Promise.all([
    getActiveSessions(orgId, branchId),
    getUnreadAlerts(orgId, branchId),
    getTodayStats(orgId, branchId),
  ]);

  if (isTV) {
    return (
      <div style={{ background: "#0c0a09", minHeight: "100vh", color: "white", padding: 24 }}>
        <MonitorTickClient />
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 14, opacity: 0.6, letterSpacing: 0.5 }}>PLAYLAND · LIVE</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>คนในร้าน · {activeSessions.length} คน</div>
          </div>
          <div style={{ fontSize: 14, opacity: 0.6 }}>อัปเดต {fmtTime(new Date())}</div>
        </header>
        {activeSessions.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", height: "60vh", color: "#71717a" }}>
            <Tv size={64} opacity={0.4} />
            <div style={{ marginTop: 12 }}>ยังไม่มีใครเล่นในร้าน</div>
          </div>
        ) : (
          <div className="pl-tv-grid" style={{ background: "transparent" }}>
            {activeSessions.map((s) => {
              const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
              const remainMin = remainingMs ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
              const warn = remainMin !== null && remainMin < 10;
              const danger = remainMin !== null && remainMin <= 0;
              return (
                <div key={s.id} className={`pl-tv-card${danger ? " is-danger" : warn ? " is-warn" : ""}`} style={{ background: "#1c1917", color: "white", borderColor: danger ? "#dc2626" : warn ? "#f97316" : "#27272a" }}>
                  <div className="pl-avatar" style={{ background: "#3f3f46", display: "grid", placeItems: "center", color: "white", fontSize: 24, fontWeight: 700 }}>
                    {s.member.nickname?.[0] ?? s.member.name?.[0] ?? "?"}
                  </div>
                  <div>
                    <div className="pl-tv-name">{s.member.nickname ?? s.member.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{s.package?.name ?? "—"}</div>
                    <div className="pl-tv-time" data-expires-at={s.expiresAt?.toISOString() ?? ""} style={{ color: danger ? "#fca5a5" : warn ? "#fdba74" : "#a3e635" }}>
                      {s.packageMinutes === 0 ? "Day Pass" : remainMin !== null ? `${remainMin} นาที` : "—"}
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

  // Dashboard mode (default)
  return (
    <div className="pl-page">
      <MonitorTickClient />
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Live Monitor</div>
          <h1>คนในร้าน · {activeSessions.length} คน</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/playland/monitor?tv=1" className="pl-btn">
            <Tv size={14} /> โหมด TV (จอใหญ่)
          </Link>
          <Link href="/playland" className="pl-btn">กลับ Workspace</Link>
        </div>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <div className="pl-card pl-stat"><span className="pl-stat-label">ในร้าน</span><span className="pl-stat-value">{stats.activeSessions}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">วันนี้รวม</span><span className="pl-stat-value">{stats.sessionsToday}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">หมดเวลา</span><span className="pl-stat-value">{stats.expiredSessions}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">รายได้วันนี้</span><span className="pl-stat-value">{thbShort(stats.totalRevenueCents)}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">จองวันนี้</span><span className="pl-stat-value">{stats.bookingsToday}</span></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 0, height: "calc(100% - 130px)" }}>
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
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="pl-empty"><Activity size={32} opacity={0.4} />ไม่มี session ที่ active</div>
                  </td>
                </tr>
              )}
              {activeSessions.map((s) => {
                const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
                const remainMin = remainingMs !== null ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
                const danger = remainMin !== null && remainMin <= 0;
                const warn = remainMin !== null && remainMin < 10;
                return (
                  <tr key={s.id}>
                    <td><div style={{ fontWeight: 600 }}>{s.member.nickname ?? s.member.name}</div><div style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{s.member.memberCode}</div></td>
                    <td><span className="pl-chip pl-chip-brand">{s.member.type}</span></td>
                    <td>{s.package?.name ?? "—"} · {s.packageMinutes === 0 ? "ทั้งวัน" : `${s.packageMinutes} นาที`}</td>
                    <td>{fmtTime(s.checkInAt)}</td>
                    <td>{fmtElapsed(s.checkInAt)}</td>
                    <td><span className={`pl-countdown${danger ? " is-danger" : warn ? " is-warn" : ""}`} data-expires-at={s.expiresAt?.toISOString() ?? ""}>{s.packageMinutes === 0 ? "ไม่จำกัด" : remainMin !== null ? `${remainMin}น.` : "—"}</span></td>
                    <td><span className={sessionStatusChipClass(s.status)}>{sessionStatusLabel(s.status)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="pl-pane" style={{ overflowY: "auto" }}>
          <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid var(--pl-line)" }}>
            <div className="pl-eyebrow">แจ้งเตือนล่าสุด · {alerts.length}</div>
          </div>
          {alerts.length === 0 ? (
            <div className="pl-empty"><CheckCircle2 size={28} opacity={0.4} />ไม่มีแจ้งเตือน</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {alerts.map((a) => (
                <li key={a.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--pl-line)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span className={alertSeverityChipClass(a.severity)}>{a.severity}</span>
                    <span style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{fmtTime(a.createdAt)}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                  {a.message && <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 2 }}>{a.message}</div>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
