// DocuFlow · Notifications Center (DesktopNotifications canvas)
// ────────────────────────────────────────────────────────────────────
// Inbox of DocuFlow-related notifications: expiry alerts (computed from
// renewals), pending signatures, and recent uploads.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  AlertTriangle,
  Clock,
  PenSquare,
  CheckCircle2,
  Upload,
  Megaphone,
  Settings,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadRenewals, loadDocuments } from "@/lib/docuflow/data";
import { prisma } from "@/lib/prisma";
import { thaiDateLong, bkkRelative } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

interface NotifItem {
  id: string;
  kind: "danger" | "brand" | "warn" | "accent" | "success" | "ink";
  icon: React.ReactNode;
  title: string;
  body: string;
  time: string;
  at: Date;
  unread: boolean;
  href: string;
  action?: string;
}

export default async function NotificationsCenterPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;

  const [renewals, recent, pendingSignatures] = await Promise.all([
    loadRenewals(orgId, { withinDays: 60 }),
    loadDocuments(orgId, { limit: 10 }),
    prisma.documentSignaturePlacement.findMany({
      where: {
        document: { orgId, isActive: true },
        signerUserId: session.user.id,
        signedAt: null,
      },
      include: {
        document: { select: { id: true, name: true } },
      },
      take: 8,
    }),
  ]);

  const notifs: NotifItem[] = [];

  const now = new Date();

  // Expiry alerts (use today as the trigger date)
  for (const r of renewals.slice(0, 5)) {
    if (r.daysUntilExpiry > 30) continue;
    const isExpired = r.daysUntilExpiry < 0;
    notifs.push({
      id: `exp-${r.id}`,
      kind: isExpired || r.daysUntilExpiry <= 7 ? "danger" : "warn",
      icon: isExpired ? <AlertTriangle size={18} /> : <Clock size={18} />,
      title: isExpired
        ? `${r.document.name} หมดอายุแล้ว`
        : `${r.document.name} ใกล้หมด ${r.daysUntilExpiry} วัน`,
      body: r.notes ?? "ต้องดำเนินการต่ออายุ",
      time: bkkRelative(now),
      at: now,
      unread: true,
      href: `/docuflow/documents/${r.document.id}`,
      action: "ต่ออายุเลย",
    });
  }

  // Pending signatures
  for (const p of pendingSignatures.slice(0, 5)) {
    notifs.push({
      id: `sig-${p.id}`,
      kind: "brand",
      icon: <PenSquare size={18} />,
      title: `รอเซ็น: ${p.document.name}`,
      body: "เอกสารพร้อมรับลายเซ็น — เปิดดูเพื่อดำเนินการ",
      time: bkkRelative(now),
      at: now,
      unread: true,
      href: `/docuflow/documents/${p.document.id}/signatures`,
      action: "ดู",
    });
  }

  // Recent uploads
  for (const d of recent.slice(0, 5)) {
    notifs.push({
      id: `up-${d.id}`,
      kind: "success",
      icon: <Upload size={18} />,
      title: `อัปโหลดแล้ว: ${d.name}`,
      body: "เอกสารพร้อมใช้งานในระบบ",
      time: bkkRelative(d.uploadedAt),
      at: d.uploadedAt,
      unread: false,
      href: `/docuflow/documents/${d.id}`,
    });
  }

  const unreadCount = notifs.filter((n) => n.unread).length;

  // Group by day bucket: วันนี้ / เมื่อวาน / เก่ากว่า
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today0 = startOfDay(now);
  const yest0 = new Date(today0.getTime() - 86400000);

  const groups: Array<{ label: string; items: NotifItem[] }> = [
    { label: "วันนี้", items: [] },
    { label: "เมื่อวาน", items: [] },
    { label: "เก่ากว่า", items: [] },
  ];
  for (const n of notifs) {
    const nd = startOfDay(n.at);
    if (nd.getTime() >= today0.getTime()) groups[0].items.push(n);
    else if (nd.getTime() >= yest0.getTime()) groups[1].items.push(n);
    else groups[2].items.push(n);
  }

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "การแจ้งเตือน" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>การแจ้งเตือน</DfEyebrow>}
        title={
          <>
            Inbox · <span style={{ color: "var(--df-accent)" }}>{unreadCount} ใหม่</span>
          </>
        }
        description={`${notifs.length} เหตุการณ์ · ดูเฉพาะที่ต้องความสนใจ`}
        actions={
          <>
            <DfButton variant="ghost" size="sm">
              ทำเครื่องหมายอ่านทั้งหมด
            </DfButton>
            <DfButton variant="ghost">
              <Settings size={14} />
              ตั้งค่า
            </DfButton>
          </>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 280px)",
          gap: 22,
        }}
        className="df-grid-2col"
      >
        {/* LEFT — list */}
        <div className="df-fade-up df-fade-up-100">
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <DfPill tone="ink" small>ทั้งหมด · {notifs.length}</DfPill>
            <DfPill tone="outline" small>ยังไม่อ่าน · {unreadCount}</DfPill>
            <DfPill tone="outline" small>ด่วน</DfPill>
            <DfPill tone="outline" small>ต่ออายุ</DfPill>
          </div>

          <DfCard padding={0} style={{ overflow: "hidden" }}>
            {notifs.length === 0 ? (
              <div
                style={{
                  padding: 36,
                  textAlign: "center",
                  color: "var(--df-muted)",
                }}
              >
                <Bell size={28} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 14 }}>ยังไม่มีการแจ้งเตือนล่าสุด</div>
              </div>
            ) : (
              groups.map((g) => {
                if (g.items.length === 0) return null;
                return (
                  <div key={g.label}>
                    <div
                      style={{
                        padding: "10px 20px",
                        background: "var(--df-surface-soft)",
                        borderBottom: "1px solid var(--df-line)",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--df-muted)",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {g.label} · {g.items.length} เหตุการณ์
                    </div>
                    {g.items.map((n, i) => {
                      const last = i === g.items.length - 1;
                      return (
                        <Link
                          key={n.id}
                          href={n.href}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr auto",
                            gap: 14,
                            padding: "16px 20px",
                            alignItems: "center",
                            borderBottom: last
                              ? "none"
                              : "1px solid var(--df-line-soft)",
                            background: n.unread
                              ? "var(--df-surface)"
                              : "var(--df-surface-soft)",
                            position: "relative",
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          {n.unread && (
                            <div
                              style={{
                                position: "absolute",
                                left: 8,
                                top: 22,
                                width: 6,
                                height: 6,
                                borderRadius: 99,
                                background: "var(--df-accent)",
                              }}
                            />
                          )}
                          <div
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 10,
                              background:
                                n.kind === "ink"
                                  ? "var(--df-bg-warm)"
                                  : `var(--df-${n.kind}-soft)`,
                              color:
                                n.kind === "ink"
                                  ? "var(--df-ink-2)"
                                  : `var(--df-${n.kind})`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {n.icon}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: n.unread ? 700 : 500,
                                marginBottom: 2,
                              }}
                            >
                              {n.title}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--df-muted)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {n.body}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            {n.action && (
                              <DfPill tone="brand" small>
                                {n.action}
                              </DfPill>
                            )}
                            <span
                              style={{ fontSize: 11, color: "var(--df-muted)" }}
                              className="df-tnum"
                            >
                              {n.time}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                );
              })
            )}
          </DfCard>
        </div>

        {/* RIGHT — settings */}
        <div className="df-fade-up df-fade-up-200">
          <DfCard padding={18}>
            <DfEyebrow>ช่องทางแจ้งเตือน</DfEyebrow>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {[
                { n: "ในระบบ", on: true },
                { n: "อีเมล", on: true },
                { n: "Line", on: true },
                { n: "SMS", on: false },
                { n: "Push (มือถือ)", on: true },
              ].map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom:
                      i < 4 ? "1px solid var(--df-line-soft)" : "none",
                  }}
                >
                  <span style={{ fontSize: 13 }}>{c.n}</span>
                  <div
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 99,
                      background: c.on ? "var(--df-success)" : "var(--df-line)",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 99,
                        background: "#fff",
                        position: "absolute",
                        top: 2,
                        left: c.on ? 18 : 2,
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </DfCard>

          <DfCard padding={18} style={{ marginTop: 12 }}>
            <DfEyebrow>เตือนล่วงหน้า</DfEyebrow>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {[
                "90 วันก่อนหมด",
                "30 วันก่อนหมด",
                "7 วันก่อนหมด",
                "วันที่หมดอายุ",
              ].map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    background: "var(--df-surface-soft)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  <CheckCircle2
                    size={13}
                    style={{ color: "var(--df-success)" }}
                  />
                  <span style={{ flex: 1 }}>{r}</span>
                </div>
              ))}
            </div>
          </DfCard>

          <DfCard
            padding={14}
            warm
            style={{
              marginTop: 12,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <Megaphone size={16} style={{ color: "var(--df-accent)" }} />
            <div style={{ flex: 1, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                เปิด "อย่ารบกวน"
              </div>
              <div style={{ color: "var(--df-muted)" }}>
                20:00 – 08:00 · ส.-อา.
              </div>
            </div>
          </DfCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
