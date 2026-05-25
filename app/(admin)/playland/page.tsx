// Playland · Cashier Cockpit (root /playland)
//
// Concept: the cashier's home base · everything that can happen here, happens
// here. No bouncing between tabs for routine work.
//
// Layout (3-pane):
//   LEFT  ⤇ Active sessions (live · click selects inspector)
//   CENTER ⤇ Action tabs: Register | Quick Check-in | POS
//   RIGHT ⤇ Inspector (selected session detail) OR alerts feed (default)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, getUnreadAlerts, getTodayStats, listPackages, listBranches } from "@/lib/playland/queries";
import { prisma } from "@/lib/prisma";
import { fmtTime, fmtElapsed, sessionStatusLabel, thb, thbShort, memberTypeLabel, fmtDateTime } from "@/lib/playland/format";
import { MemberRegisterForm } from "@/components/playland/member-register-form";
import { MonitorTickClient } from "@/components/playland/monitor-tick-client";
import { SessionInspector } from "@/components/playland/session-inspector";
import { NavSelect } from "@/components/playland/nav-select";
import { CashierHeaderActions } from "@/components/playland/cashier-header-actions";
import { Activity, Bell, Smile, Sparkles, Tv, Search } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CashierCockpit({ searchParams }: { searchParams: Promise<{ branch?: string; selected?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const cashier = session.user.name || session.user.email || "พนักงาน";

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;

  // No branch yet → onboarding canvas
  if (!branchId) {
    return (
      <div className="pl-page">
        <header className="pl-header">
          <div>
            <div className="pl-eyebrow"><Sparkles size={11} /> playland · เริ่มต้น</div>
            <h1>ตั้งค่าครั้งแรก</h1>
          </div>
        </header>
        <div style={{ display: "grid", placeItems: "center", padding: 48 }}>
          <div className="pl-card pl-card-accent" style={{ maxWidth: 560 }}>
            <div className="pl-empty-icon" style={{ marginBottom: 12 }}><Smile size={28} /></div>
            <div className="pl-empty-title" style={{ marginBottom: 6 }}>ยังไม่มีสาขา</div>
            <div className="pl-empty-message" style={{ marginBottom: 16 }}>
              ก่อนเริ่มรับลูกค้า สร้างสาขาแรกก่อน · จากนั้นจะตั้ง package · device · สินค้า POS ได้
            </div>
            <Link href="/playland/settings/branches" className="pl-btn pl-btn-primary pl-btn-lg">
              ไปสร้างสาขาแรก →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const branch = branches.find((b) => b.id === branchId)!;
  const [activeSessions, alerts, stats, packages, familyGroups] = await Promise.all([
    getActiveSessions(orgId, branchId),
    getUnreadAlerts(orgId, branchId),
    getTodayStats(orgId, branchId),
    listPackages(orgId, branchId),
    prisma.playlandFamilyGroup.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const selectedId = sp.selected;
  const selectedSession = selectedId ? activeSessions.find((s) => s.id === selectedId) ?? null : null;
  const openShift = await prisma.playlandShift.findFirst({
    where: { orgId, branchId, cashierUserId: session.user.id, status: "OPEN" },
    select: { id: true, shiftCode: true, startedAt: true, totalSalesCents: true },
  });

  return (
    <div className="pl-page">
      <MonitorTickClient />
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">
            <Sparkles size={11} />
            playland · {branch.name} · สวัสดี {cashier}
          </div>
          <h1>
            Cashier Cockpit
            <span style={{
              marginLeft: 14,
              fontSize: 13,
              color: "var(--pl-text-muted)",
              fontFamily: "var(--pl-font-mono)",
              fontWeight: 400,
              letterSpacing: "-0.005em",
            }}>
              {stats.activeSessions} ในร้าน · {thbShort(stats.totalRevenueCents)} วันนี้
              {openShift && <> · กะเปิดอยู่ {fmtTime(openShift.startedAt)}</>}
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="pl-btn pl-btn-ghost" onClick={undefined} style={{ pointerEvents: "none" }}>
            <Search size={14} /> ค้นหา <span className="pl-kbd-inline">⌘K</span>
          </button>
          {branches.length > 1 && (
            <NavSelect param="branch" value={branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 170 }} />
          )}
          <Link href={`/playland/monitor?branch=${branchId}`} className="pl-btn"><Activity size={14} /> Monitor</Link>
          <Link href={`/playland/monitor?tv=1&branch=${branchId}`} className="pl-btn"><Tv size={14} /> TV</Link>
          <CashierHeaderActions branchId={branchId} openShift={openShift ? { id: openShift.id, totalSalesCents: openShift.totalSalesCents } : null} />
        </div>
      </header>

      <div className="pl-three-pane">
        {/* ╭─ LEFT ─ Active sessions live list ───────────────────╮ */}
        <aside className="pl-pane">
          <div className="pl-pane-head">
            <div>
              <div className="pl-pane-title">ในร้านตอนนี้</div>
              <div className="pl-pane-count">{activeSessions.length} คน · เริ่มวันนี้ {stats.sessionsToday}</div>
            </div>
          </div>
          {activeSessions.length === 0 ? (
            <div className="pl-empty">
              <div className="pl-empty-icon"><Smile size={24} /></div>
              <div className="pl-empty-title">ยังไม่มีใครเล่น</div>
              <div className="pl-empty-message">
                ลงทะเบียนเด็กคนแรกตรงกลาง · หรือกด <span className="pl-kbd">⌘K</span> หาลูกค้าเก่า
              </div>
            </div>
          ) : (
            <ul className="pl-stagger" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {activeSessions.map((s) => {
                const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
                const remainMin = remainingMs !== null ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
                const danger = remainMin !== null && remainMin <= 0;
                const warn = remainMin !== null && remainMin < 10;
                const isSel = selectedId === s.id;
                const href = isSel ? `/playland?branch=${branchId}` : `/playland?branch=${branchId}&selected=${s.id}`;
                return (
                  <li key={s.id}>
                    <Link href={href} className={`pl-session-row${isSel ? " is-selected" : ""}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div className="pl-session-top">
                        <span className="pl-session-name">{s.member.nickname ?? s.member.name}</span>
                        <span className={`pl-countdown${danger ? " is-danger" : warn ? " is-warn" : ""}`} data-expires-at={s.expiresAt?.toISOString() ?? ""}>
                          {s.packageMinutes === 0 ? "∞" : remainMin !== null ? `${remainMin}น` : "—"}
                        </span>
                      </div>
                      <div className="pl-session-meta">
                        {memberTypeLabel(s.member.type).toLowerCase()} · {s.package?.name ?? "—"} · {fmtTime(s.checkInAt)} ({fmtElapsed(s.checkInAt)})
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ╭─ CENTER ─ Action tabs · register form by default ────╮ */}
        <main className="pl-pane">
          <div className="pl-tabs">
            <div className="pl-tab is-active">ลงทะเบียนใหม่</div>
            <Link href="/playland/members" className="pl-tab">ค้นหา · Check-in เก่า</Link>
            <Link href="/playland/pos" className="pl-tab">POS</Link>
            <Link href="/playland/bookings" className="pl-tab">การจองวันนี้</Link>
          </div>
          <MemberRegisterForm branchId={branchId} packages={packages} familyGroups={familyGroups} />
        </main>

        {/* ╭─ RIGHT ─ Inspector (if selected) or alerts feed ─────╮ */}
        <aside className="pl-pane">
          {selectedSession ? (
            <SessionInspector
              session={{
                id: selectedSession.id,
                memberName: selectedSession.member.nickname ?? selectedSession.member.name,
                memberType: selectedSession.member.type,
                memberCode: selectedSession.member.memberCode,
                phone: selectedSession.member.phone,
                photoR2Path: selectedSession.member.photoR2Path,
                packageName: selectedSession.package?.name ?? "—",
                packageMinutes: selectedSession.packageMinutes,
                packagePriceCents: selectedSession.packagePriceCents,
                checkInAt: selectedSession.checkInAt.toISOString(),
                expiresAt: selectedSession.expiresAt?.toISOString() ?? null,
                status: selectedSession.status,
              }}
              packages={packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes ?? 0 }))}
              backHref={`/playland?branch=${branchId}`}
            />
          ) : (
            <>
              <div className="pl-pane-head">
                <div>
                  <div className="pl-pane-title">แจ้งเตือน</div>
                  <div className="pl-pane-count">{alerts.length} รายการ ที่ยังไม่ resolve</div>
                </div>
              </div>
              {alerts.length === 0 ? (
                <div className="pl-empty">
                  <div className="pl-empty-icon"><Bell size={22} /></div>
                  <div className="pl-empty-title">เงียบ ๆ ดี</div>
                  <div className="pl-empty-message">เด็กใกล้หมดเวลา · stranger · tailgate จะเด้งที่นี่</div>
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
