// DocuFlow · Audit Log (canvas DesktopAudit)
// ────────────────────────────────────────────────────────────────────
// ISO 27001-style audit trail · grouped by day · filter pills · stat strip.
// Reads from audit_logs scoped to DOCUFLOW_* actions for this org.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Filter,
  Search,
  Upload,
  PenSquare,
  Eye,
  XCircle,
  Lock,
  Plus,
  Share2,
  ChevronRight,
  FileText,
  Sparkles,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { thaiDateLong, bkkRelative } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfAvatar,
  DfStatCard,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

const DOCUFLOW_ACTIONS = [
  "DOCUFLOW_UPLOAD",
  "DOCUFLOW_RENEW",
  "DOCUFLOW_TAG",
  "DOCUFLOW_DELETE",
  "DOCUFLOW_SHARE",
  "DOCUFLOW_SIGN_PLACEMENT_ADD",
  "DOCUFLOW_SIGN_PLACEMENT_UPDATE",
  "DOCUFLOW_SIGN_PLACEMENT_DELETE",
  "DOCUFLOW_SIGN_PLACEMENT_RESET",
  "DOCUFLOW_SIGNATURE_SIGNED",
] as const;

const ACTION_META: Record<
  string,
  {
    icon: React.ReactNode;
    tone: "danger" | "warn" | "success" | "brand" | "accent" | "outline";
    label: string;
  }
> = {
  DOCUFLOW_UPLOAD: {
    icon: <Upload size={17} />,
    tone: "brand",
    label: "อัปโหลด",
  },
  DOCUFLOW_RENEW: {
    icon: <Plus size={17} />,
    tone: "success",
    label: "ต่ออายุ",
  },
  DOCUFLOW_TAG: {
    icon: <Filter size={17} />,
    tone: "outline",
    label: "แก้แท็ก",
  },
  DOCUFLOW_DELETE: {
    icon: <XCircle size={17} />,
    tone: "danger",
    label: "ลบเอกสาร",
  },
  DOCUFLOW_SHARE: {
    icon: <Share2 size={17} />,
    tone: "brand",
    label: "แชร์",
  },
  DOCUFLOW_SIGN_PLACEMENT_ADD: {
    icon: <Plus size={17} />,
    tone: "brand",
    label: "เพิ่มจุดเซ็น",
  },
  DOCUFLOW_SIGN_PLACEMENT_UPDATE: {
    icon: <PenSquare size={17} />,
    tone: "warn",
    label: "แก้จุดเซ็น",
  },
  DOCUFLOW_SIGN_PLACEMENT_DELETE: {
    icon: <XCircle size={17} />,
    tone: "danger",
    label: "ลบจุดเซ็น",
  },
  DOCUFLOW_SIGN_PLACEMENT_RESET: {
    icon: <Eye size={17} />,
    tone: "warn",
    label: "ล้างลายเซ็น",
  },
  DOCUFLOW_SIGNATURE_SIGNED: {
    icon: <PenSquare size={17} />,
    tone: "success",
    label: "ลงนามแล้ว",
  },
};

interface SP {
  action?: string;
  user?: string;
  days?: string;
}

export default async function DocuFlowAuditPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const sp = await searchParams;

  const days = Math.max(1, Math.min(90, parseInt(sp.days ?? "7", 10) || 7));
  const since = new Date(Date.now() - days * 86400000);

  const filterAction = sp.action || "";

  const [events, total, signedCount, deleteCount, ipsDistinct, allUsers] =
    await Promise.all([
      prisma.auditLog.findMany({
        where: {
          orgId,
          action: filterAction
            ? filterAction
            : { in: DOCUFLOW_ACTIONS as unknown as string[] },
          createdAt: { gte: since },
        },
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.auditLog.count({
        where: {
          orgId,
          action: { in: DOCUFLOW_ACTIONS as unknown as string[] },
          createdAt: { gte: since },
        },
      }),
      prisma.auditLog.count({
        where: {
          orgId,
          action: "DOCUFLOW_SIGNATURE_SIGNED",
          createdAt: { gte: since },
        },
      }),
      prisma.auditLog.count({
        where: {
          orgId,
          action: "DOCUFLOW_DELETE",
          createdAt: { gte: since },
        },
      }),
      prisma.auditLog
        .findMany({
          where: {
            orgId,
            action: { in: DOCUFLOW_ACTIONS as unknown as string[] },
            createdAt: { gte: since },
            ipAddress: { not: null },
          },
          select: { ipAddress: true },
          distinct: ["ipAddress"],
        })
        .then((rs) => rs.length),
      prisma.user.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 50,
      }),
    ]);

  // Group events by day
  const groups: Map<string, typeof events> = new Map();
  for (const e of events) {
    const key = e.createdAt.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const ydayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dayLabel = (k: string) => {
    if (k === todayKey) return "วันนี้";
    if (k === ydayKey) return "เมื่อวาน";
    return thaiDateLong(new Date(k));
  };

  // Color the avatar by role hash
  const userColor = (id: string) => {
    const colors = ["#0E2D7A", "#1B47B5", "#1F7A4D", "#C46A3D", "#7C3AED"];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
  };
  const initials = (name: string) => {
    if (!name) return "??";
    const parts = name.trim().split(/\s+/);
    return (
      (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
    ).toUpperCase();
  };

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "Audit Log" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>ความเคลื่อนไหวเหวการณ์</DfEyebrow>}
        title={
          <>
            Audit Log{" "}
            <span style={{ color: "var(--df-muted)" }}>·</span>{" "}
            <span style={{ color: "var(--df-ink-2)" }}>
              {total.toLocaleString("th-TH")} เหตุการณ์
            </span>
          </>
        }
        description={`เก็บทุกระเบียบ action ตามมาตรฐาน ISO 27001 · ใน ${days} วันล่าสุด`}
        actions={
          <>
            <DfButton variant="ghost">
              <Download size={14} />
              Export CSV
            </DfButton>
            <DfButton variant="ghost">
              <Filter size={14} />
              ตัวกรอง · {filterAction ? 1 : 0}
            </DfButton>
          </>
        }
      />

      {/* Stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
        className="df-fade-up df-fade-up-100"
      >
        <DfStatCard
          label="วันนี้"
          value={groups.get(todayKey)?.length ?? 0}
          tone="brand"
          icon={<Eye size={17} />}
        />
        <DfStatCard
          label={`${days} วันล่าสุด`}
          value={total}
          tone="ink"
          icon={<FileText size={17} />}
        />
        <DfStatCard
          label="ลงนาม/อนุมัติ"
          value={signedCount}
          tone="success"
          icon={<PenSquare size={17} />}
        />
        <DfStatCard
          label="ลบ/ยกเลิก"
          value={deleteCount}
          tone={deleteCount > 0 ? "danger" : "ink"}
          icon={<XCircle size={17} />}
        />
        <DfStatCard
          label="IP แยกกัน"
          value={ipsDistinct}
          tone="ink"
          icon={<Lock size={17} />}
        />
      </div>

      {/* Filter pills row */}
      <DfCard
        padding={16}
        className="df-fade-up df-fade-up-100"
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            padding: "0 12px",
            background: "var(--df-bg-warm)",
            borderRadius: 8,
            height: 36,
            minWidth: 220,
          }}
        >
          <Search size={14} style={{ color: "var(--df-muted)" }} />
          <input
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              flex: 1,
              fontSize: 13,
              fontFamily: "inherit",
            }}
            placeholder="ค้นหา user, action, เอกสาร…"
          />
        </label>
        {DOCUFLOW_ACTIONS.slice(0, 5).map((a) => {
          const meta = ACTION_META[a];
          const active = filterAction === a;
          const params = new URLSearchParams();
          if (!active) params.set("action", a);
          if (sp.days) params.set("days", sp.days);
          const href = params.toString()
            ? `/docuflow/audit?${params.toString()}`
            : "/docuflow/audit";
          return (
            <Link key={a} href={href} style={{ textDecoration: "none" }}>
              <DfPill tone={active ? "brand" : "outline"} small>
                {meta?.label ?? a}
              </DfPill>
            </Link>
          );
        })}
        {filterAction && (
          <Link
            href={`/docuflow/audit${sp.days ? `?days=${sp.days}` : ""}`}
            style={{
              fontSize: 12,
              color: "var(--df-brand)",
              fontWeight: 600,
              textDecoration: "none",
              marginLeft: 4,
            }}
          >
            ล้างตัวกรอง
          </Link>
        )}
      </DfCard>

      {/* Timeline */}
      <DfCard padding={0} style={{ overflow: "hidden" }}>
        {events.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "var(--df-muted)",
            }}
          >
            <Eye
              size={28}
              style={{ marginBottom: 8 }}
            />
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              ยังไม่มี audit event ในช่วงนี้
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              ลองขยายช่วงเวลาด้านบน
            </div>
          </div>
        ) : (
          Array.from(groups.entries()).map(([day, list]) => (
            <div key={day}>
              <div
                className="df-sticky-head"
                style={{
                  padding: "12px 22px",
                  background: "var(--df-surface-soft)",
                  borderBottom: "1px solid var(--df-line)",
                  borderTop:
                    day === Array.from(groups.keys())[0]
                      ? "none"
                      : "1px solid var(--df-line)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                }}
              >
                {dayLabel(day)} · {list.length} เหตุการณ์
              </div>
              {list.map((e) => {
                const meta =
                  ACTION_META[e.action] ?? {
                    icon: <Eye size={17} />,
                    tone: "outline" as const,
                    label: e.action,
                  };
                const userName = e.user?.name ?? "ระบบ";
                const color = e.user ? userColor(e.user.id) : "#9AA1B2";
                const diff = (e.diff as Record<string, unknown> | null) ?? {};
                const newData = (diff.new as Record<string, unknown> | undefined) ?? {};
                const targetText =
                  (newData.documentName as string | undefined) ??
                  (newData.name as string | undefined) ??
                  e.resourceType ??
                  "—";
                return (
                  <div
                    key={e.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto auto 1fr auto",
                      gap: 16,
                      alignItems: "center",
                      padding: "14px 22px",
                      borderBottom: "1px solid var(--df-line-soft)",
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: `var(--df-${meta.tone}-soft)`,
                        color: `var(--df-${meta.tone})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <DfAvatar
                        initials={initials(userName)}
                        color={color}
                        size="sm"
                      />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {userName}
                      </span>
                    </div>
                    <div>
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: "var(--df-muted)" }}>
                          {meta.label} ·{" "}
                        </span>
                        <b>{targetText}</b>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--df-muted)",
                          marginTop: 2,
                        }}
                      >
                        {e.ipAddress && <>IP {e.ipAddress} · </>}
                        {e.resourceType ?? "—"}
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      <span
                        className="df-tnum"
                        style={{ fontSize: 12, color: "var(--df-muted)" }}
                      >
                        {bkkRelative(e.createdAt)}
                      </span>
                      <ChevronRight
                        size={14}
                        style={{ color: "var(--df-muted-2)" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </DfCard>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--df-muted)",
        }}
      >
        <Sparkles size={11} /> ระบบบันทึก audit ทุกการกระทำตามมาตรฐาน ISO 27001
        · เก็บ 7 ปี · ไม่สามารถลบได้ ({allUsers.length} users tracked)
      </div>
    </div>
  );
}
