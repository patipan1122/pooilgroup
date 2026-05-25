// Playland · Cashier Workspace (root /playland)
// 3-pane: LEFT active sessions live · CENTER register form · RIGHT alerts feed

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, getUnreadAlerts, getTodayStats, listPackages, listBranches } from "@/lib/playland/queries";
import { prisma } from "@/lib/prisma";
import { fmtTime, fmtElapsed, sessionStatusChipClass, sessionStatusLabel, thbShort, memberTypeLabel } from "@/lib/playland/format";
import { MemberRegisterForm } from "@/components/playland/member-register-form";
import { MonitorTickClient } from "@/components/playland/monitor-tick-client";
import { SessionActions } from "@/components/playland/session-actions";
import { NavSelect } from "@/components/playland/nav-select";
import { Activity, Bell, Smile, Clock, Tv } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CashierWorkspacePage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;

  if (!branchId) {
    return (
      <div className="pl-page">
        <header className="pl-header"><h1>Playland · ตั้งค่าก่อนเริ่ม</h1></header>
        <div style={{ padding: 32, maxWidth: 600, margin: "0 auto" }}>
          <div className="pl-card" style={{ background: "var(--pl-brand-soft)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>ยังไม่มีสาขา</div>
            <div style={{ fontSize: 13, color: "var(--pl-brand-ink)", marginBottom: 12 }}>
              ก่อนใช้งาน Playland ต้องสร้างสาขาก่อน · ไปที่ Settings
            </div>
            <Link href="/playland/settings/branches" className="pl-btn pl-btn-primary">ไปสร้างสาขา</Link>
          </div>
        </div>
      </div>
    );
  }

  const [activeSessions, alerts, stats, packages, familyGroups] = await Promise.all([
    getActiveSessions(orgId, branchId),
    getUnreadAlerts(orgId, branchId),
    getTodayStats(orgId, branchId),
    listPackages(orgId, branchId),
    prisma.playlandFamilyGroup.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const cashier = session.user.name || session.user.email || "พนักงาน";

  return (
    <div className="pl-page">
      <MonitorTickClient />
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · Cashier · สวัสดี {cashier}</div>
          <h1>
            {branches.find((b) => b.id === branchId)?.name ?? "ไม่ระบุสาขา"}
            <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 400, color: "var(--pl-text-muted)" }}>
              ในร้านตอนนี้ {stats.activeSessions} คน · รายได้วันนี้ {thbShort(stats.totalRevenueCents)}
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {branches.length > 1 && (
            <NavSelect
              param="branch"
              value={branchId}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              style={{ width: 180 }}
            />
          )}
          <Link href={`/playland/monitor?branch=${branchId}`} className="pl-btn"><Activity size={14} /> Monitor</Link>
          <Link href={`/playland/monitor?tv=1&branch=${branchId}`} className="pl-btn"><Tv size={14} /> TV mode</Link>
          <Link href="/playland/shifts" className="pl-btn pl-btn-primary"><Clock size={14} /> ปิดกะ/ปิดวัน</Link>
        </div>
      </header>

      <div className="pl-three-pane">
        {/* LEFT — Active sessions */}
        <aside className="pl-pane">
          <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid var(--pl-line)" }}>
            <div className="pl-eyebrow">ในร้านตอนนี้ · {activeSessions.length} คน</div>
          </div>
          {activeSessions.length === 0 ? (
            <div className="pl-empty">
              <Smile size={36} opacity={0.4} />
              <div>ยังไม่มีใคร · ลงทะเบียนเด็กคนแรกตรงกลาง</div>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {activeSessions.map((s) => {
                const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
                const remainMin = remainingMs !== null ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
                const danger = remainMin !== null && remainMin <= 0;
                const warn = remainMin !== null && remainMin < 10;
                return (
                  <li key={s.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--pl-line)", display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600 }}>{s.member.nickname ?? s.member.name}</span>
                      <span className={sessionStatusChipClass(s.status)}>{sessionStatusLabel(s.status)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>
                      {memberTypeLabel(s.member.type)} · {s.package?.name ?? "—"} · เข้า {fmtTime(s.checkInAt)} ({fmtElapsed(s.checkInAt)})
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div className={`pl-countdown${danger ? " is-danger" : warn ? " is-warn" : ""}`} data-expires-at={s.expiresAt?.toISOString() ?? ""}>
                        {s.packageMinutes === 0 ? "ไม่จำกัด" : remainMin !== null ? `${remainMin} นาที` : "—"}
                      </div>
                      <SessionActions sessionId={s.id} memberName={s.member.nickname ?? s.member.name} packages={packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes ?? 0 }))} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* CENTER — Register form */}
        <main className="pl-pane">
          <div className="pl-tabs">
            <div className="pl-tab is-active">ลงทะเบียนสมาชิกใหม่</div>
            <Link href="/playland/members" className="pl-tab">ค้นหา · Check-in ซ้ำ</Link>
            <Link href="/playland/pos" className="pl-tab">POS ขายขนม</Link>
            <Link href="/playland/bookings" className="pl-tab">จองล่วงหน้า</Link>
          </div>
          <MemberRegisterForm branchId={branchId} packages={packages} familyGroups={familyGroups} />
        </main>

        {/* RIGHT — Alerts */}
        <aside className="pl-pane">
          <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid var(--pl-line)" }}>
            <div className="pl-eyebrow">แจ้งเตือน · {alerts.length}</div>
          </div>
          {alerts.length === 0 ? (
            <div className="pl-empty"><Bell size={28} opacity={0.4} />ไม่มีแจ้งเตือน</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {alerts.map((a) => (
                <li key={a.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--pl-line)" }}>
                  <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{fmtTime(a.createdAt)}</div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{a.title}</div>
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
