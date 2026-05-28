// Playland · Manual gate override monitor (anti-fraud) · /bigfeature Phase A
// Shows every staff-pressed gate override with snapshot + who + why · spots abuse.
// Per [[playland-manual-override-antifraud]].

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/playland/format";
import { BackOfficeTabs } from "@/components/playland/back-office-tabs";
import { ShieldAlert, ArrowLeft, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  QR_DAMAGED: "QR เปียก/ขาด",
  NET_SLOW: "ระบบช้า",
  CHILD_EMERGENCY: "เด็กฉุกเฉิน",
  VIP_STAFF: "VIP/พนักงาน",
  OTHER: "อื่นๆ",
};

// Flag a staff member as suspicious if they override more than this in 30 days
const ABUSE_THRESHOLD = 20;

export default async function OverridesPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const logs = await prisma.playlandAuditLog.findMany({
    where: { orgId, action: "gate.manual_override", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Resolve staff names
  const userIds = [...new Set(logs.map((l) => l.actorUserId).filter(Boolean) as string[])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  // Count per staff (abuse detection)
  const countByUser = new Map<string, number>();
  for (const l of logs) {
    if (l.actorUserId) countByUser.set(l.actorUserId, (countByUser.get(l.actorUserId) ?? 0) + 1);
  }
  const ranking = [...countByUser.entries()]
    .map(([uid, count]) => ({ uid, name: nameById.get(uid) ?? uid.slice(0, 8), count }))
    .sort((a, b) => b.count - a.count);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = logs.filter((l) => new Date(l.createdAt).toISOString().slice(0, 10) === todayStr).length;

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1><ShieldAlert size={18} style={{ display: "inline", marginRight: 6, verticalAlign: -3 }} />เปิดประตูเอง · 30 วันล่าสุด</h1>
        </div>
      </header>

      <BackOfficeTabs active="overrides" />

      <div style={{ overflowY: "auto", padding: 20 }}>
        {/* Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">วันนี้</span>
            <span className="pl-stat-value">{todayCount} ครั้ง</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">30 วัน</span>
            <span className="pl-stat-value">{logs.length} ครั้ง</span>
          </div>
          <div className="pl-card pl-stat">
            <span className="pl-stat-label">พนักงานที่กด</span>
            <span className="pl-stat-value">{ranking.length} คน</span>
          </div>
        </div>

        {/* Per-staff ranking · flag abuse */}
        {ranking.length > 0 && (
          <div className="pl-card" style={{ marginBottom: 18 }}>
            <div className="pl-eyebrow" style={{ marginBottom: 8 }}>จำนวนครั้งต่อพนักงาน (30 วัน)</div>
            <div style={{ display: "grid", gap: 6 }}>
              {ranking.map((r) => {
                const abuse = r.count >= ABUSE_THRESHOLD;
                return (
                  <div key={r.uid} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>{r.name}</span>
                    {abuse && <span className="pl-chip pl-chip-danger"><AlertTriangle size={11} /> ผิดปกติ</span>}
                    <span className="pl-num" style={{ fontWeight: 700, color: abuse ? "var(--pl-danger-ink)" : "var(--pl-text)" }}>{r.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Event list with snapshots */}
        {logs.length === 0 ? (
          <div className="pl-empty">
            <div className="pl-empty-icon"><ShieldAlert size={22} /></div>
            <div className="pl-empty-title">ยังไม่มีการเปิดประตูเอง</div>
            <div className="pl-empty-message">ทุกครั้งที่พนักงานกด "เปิดประตูเอง" จะมีรูป + ชื่อคนกด + เหตุผลบันทึกที่นี่</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {logs.map((l) => {
              const meta = (l.metadata ?? {}) as Record<string, unknown>;
              const snapshotUrl = typeof meta.snapshotUrl === "string" ? meta.snapshotUrl : null;
              const reason = typeof meta.reason === "string" ? meta.reason : "OTHER";
              const reasonNote = typeof meta.reasonNote === "string" ? meta.reasonNote : null;
              const wristbandCode = typeof meta.wristbandCode === "string" ? meta.wristbandCode : null;
              return (
                <div key={l.id} className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
                  {snapshotUrl ? (
                    <img src={snapshotUrl} alt="override snapshot" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block", background: "#1c1917" }} />
                  ) : (
                    <div style={{ width: "100%", aspectRatio: "1/1", display: "grid", placeItems: "center", background: "var(--pl-ink-50)", color: "var(--pl-text-faint)" }}>
                      ไม่มีรูป
                    </div>
                  )}
                  <div style={{ padding: 10, display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span className="pl-chip pl-chip-warn" style={{ fontSize: 11 }}>{REASON_LABELS[reason] ?? reason}</span>
                      <span style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{fmtDateTime(l.createdAt)}</span>
                    </div>
                    {reasonNote && <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{reasonNote}</div>}
                    <div style={{ fontSize: 12 }}>
                      โดย <strong>{l.actorUserId ? (nameById.get(l.actorUserId) ?? l.actorUserId.slice(0, 8)) : "—"}</strong>
                    </div>
                    {wristbandCode && (
                      <div style={{ fontSize: 11, fontFamily: "var(--pl-font-mono)", color: "var(--pl-text-faint)" }}>{wristbandCode}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
