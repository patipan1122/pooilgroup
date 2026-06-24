// Playland · Manual gate override monitor (anti-fraud) · /bigfeature Phase A
// Shows every staff-pressed gate override with snapshot + who + why · spots abuse.
// Per [[playland-manual-override-antifraud]].
// อยู่ในเมนูเดิม (AdminShell) + พื้นขาว + สไตล์ Play a lot · ตัด BackOfficeTabs (หน้า/หลังปน) ออก

import { requireSession } from "@/lib/auth/session";
import { requirePlaylandAdmin } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/playland/format";
import { ShieldAlert, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "เปิดประตูเอง · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

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
  requirePlaylandAdmin(session.user.role); // log เปิดประตูเอง (anti-fraud) = แอดมินเท่านั้น
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
  const maxCount = Math.max(1, ...ranking.map((r) => r.count));

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = logs.filter((l) => new Date(l.createdAt).toISOString().slice(0, 10) === todayStr).length;
  const abuseCount = ranking.filter((r) => r.count >= ABUSE_THRESHOLD).length;

  const kpis = [
    { label: "วันนี้", value: `${todayCount}`, unit: "ครั้ง", color: INK },
    { label: "30 วันล่าสุด", value: `${logs.length}`, unit: "ครั้ง", color: INK },
    { label: "พนักงานที่กด", value: `${ranking.length}`, unit: "คน", color: INK },
    { label: "ผิดปกติ (≥20)", value: `${abuseCount}`, unit: "คน", color: abuseCount > 0 ? RED : INK },
  ];

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ShieldAlert size={20} color={BLUE} /> เปิดประตูเอง</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>บันทึกทุกครั้งที่พนักงานเปิดประตูเอง · 30 วันล่าสุด</div>
        </div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24, color: k.color }}>{k.value} <span style={{ fontSize: 13, fontFamily: MITR, color: MUTED, fontWeight: 400 }}>{k.unit}</span></div>
            </div>
          ))}
        </div>

        {/* per-staff ranking · flag abuse */}
        {ranking.length > 0 && (
          <div style={{ ...card, padding: 22, marginBottom: 18 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16, fontFamily: FREDOKA }}>จำนวนครั้งต่อพนักงาน · 30 วัน</div>
            <div style={{ display: "grid", gap: 12 }}>
              {ranking.map((r) => {
                const abuse = r.count >= ABUSE_THRESHOLD;
                return (
                  <div key={r.uid}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                      {abuse && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 500, background: "#fdeceb", color: RED }}><AlertTriangle size={11} /> ผิดปกติ</span>}
                      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14, color: abuse ? RED : INK }}>{r.count}</span>
                    </div>
                    <div style={{ height: 7, background: "#f2ebdd", borderRadius: 99 }}>
                      <div style={{ width: `${(r.count / maxCount) * 100}%`, height: "100%", background: abuse ? RED : BLUE, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* event list with snapshots */}
        {logs.length === 0 ? (
          <div style={{ ...card, padding: 48, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f4efe6", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><ShieldAlert size={22} color={MUTED} /></div>
            <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>ยังไม่มีการเปิดประตูเอง</div>
            <div style={{ fontSize: 13, color: MUTED }}>ทุกครั้งที่พนักงานกด &quot;เปิดประตูเอง&quot; จะมีรูป + ชื่อคนกด + เหตุผลบันทึกที่นี่</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
            {logs.map((l) => {
              const meta = (l.metadata ?? {}) as Record<string, unknown>;
              const snapshotUrl = typeof meta.snapshotUrl === "string" ? meta.snapshotUrl : null;
              const reason = typeof meta.reason === "string" ? meta.reason : "OTHER";
              const reasonNote = typeof meta.reasonNote === "string" ? meta.reasonNote : null;
              const wristbandCode = typeof meta.wristbandCode === "string" ? meta.wristbandCode : null;
              return (
                <div key={l.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  {snapshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={snapshotUrl} alt="override snapshot" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block", background: "#1c1917" }} />
                  ) : (
                    <div style={{ width: "100%", aspectRatio: "1/1", display: "grid", placeItems: "center", background: "#f4efe6", color: "#b3a896", fontSize: 13 }}>
                      ไม่มีรูป
                    </div>
                  )}
                  <div style={{ padding: 12, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 500, background: "#fdf3df", color: AMBER }}>{REASON_LABELS[reason] ?? reason}</span>
                      <span style={{ fontSize: 11, color: MUTED, fontFamily: MONO }}>{fmtDateTime(l.createdAt)}</span>
                    </div>
                    {reasonNote && <div style={{ fontSize: 12, color: MUTED }}>{reasonNote}</div>}
                    <div style={{ fontSize: 12 }}>
                      โดย <strong>{l.actorUserId ? (nameById.get(l.actorUserId) ?? l.actorUserId.slice(0, 8)) : "—"}</strong>
                    </div>
                    {wristbandCode && (
                      <div style={{ fontSize: 11, fontFamily: MONO, color: "#b3a896" }}>{wristbandCode}</div>
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
