// DocuFlow — Dashboard / overview
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopDashboard from design canvas:
//   greeting hero · 4 stat cards · "วันนี้ต้องทำอะไรบ้าง" tasks ·
//   ใกล้หมดอายุ · รอเซ็น · Checklist · ประกาศ.
// Data layer unchanged.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  FileText,
  Clock,
  Upload,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  Search,
  PenSquare,
  CheckCircle2,
  Wallet,
  Megaphone,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadDocuments, loadRenewals } from "@/lib/docuflow/data";
import { prisma } from "@/lib/prisma";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPill,
  DfStatCard,
  DfDocIcon,
  DfPageHeader,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

export default async function DocuFlowOverviewPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const [totalActive, renewals, recent, pendingSignaturesCount] =
    await Promise.all([
      prisma.document.count({ where: { orgId, isActive: true } }),
      loadRenewals(orgId, { withinDays: 90 }),
      loadDocuments(orgId, { limit: 10 }),
      prisma.documentSignaturePlacement.count({
        where: {
          document: { orgId, isActive: true },
          signerUserId: session.user.id,
          signedAt: null,
        },
      }),
    ]);

  const expired = renewals.filter((r) => r.expiryStatus === "expired").length;
  const critical = renewals.filter((r) => r.expiryStatus === "critical").length;
  const urgent = renewals.filter((r) => r.expiryStatus === "urgent").length;
  const watch = renewals.filter((r) => r.expiryStatus === "watch").length;
  const urgentTotal = expired + critical;
  const within30 = expired + critical + urgent;

  const taskRows: Array<{
    kind: "renew" | "sign" | "upload";
    title: string;
    sub: string;
    badge: string;
    badgeTone: "danger" | "warn" | "outline";
    href: string;
  }> = [];

  for (const r of renewals.slice(0, 3)) {
    if (r.expiryStatus === "watch" || r.expiryStatus === "normal") continue;
    const dueText =
      r.daysUntilExpiry < 0
        ? `หมดแล้ว ${Math.abs(r.daysUntilExpiry)} วัน`
        : r.daysUntilExpiry === 0
          ? "หมดวันนี้"
          : `เหลือ ${r.daysUntilExpiry} วัน`;
    taskRows.push({
      kind: "renew",
      title: `ต่ออายุ ${r.document.name}`,
      sub: dueText,
      badge:
        r.expiryStatus === "expired" || r.expiryStatus === "critical"
          ? "ด่วน"
          : "เตือน",
      badgeTone:
        r.expiryStatus === "expired" || r.expiryStatus === "critical"
          ? "danger"
          : "warn",
      href: `/docuflow/documents/${r.document.id}`,
    });
  }

  if (pendingSignaturesCount > 0) {
    taskRows.push({
      kind: "sign",
      title: `เซ็นเอกสารที่รออยู่ ${pendingSignaturesCount} ฉบับ`,
      sub: "ภายในวันนี้ — รักษา SLA 4 ชั่วโมง",
      badge: "รอเซ็น",
      badgeTone: "warn",
      href: "/docuflow/documents",
    });
  }

  if (adminTier && taskRows.length < 4) {
    taskRows.push({
      kind: "upload",
      title: "อัปโหลดเอกสารใหม่",
      sub: "AI ช่วยอ่าน + เติมข้อมูลให้",
      badge: "ง่าย",
      badgeTone: "outline",
      href: "/docuflow/documents/upload",
    });
  }

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <DfPageHeader
        eyebrow={<DfEyebrow>วันพฤหัสบดี · {thaiDateLong(new Date())}</DfEyebrow>}
        title={
          <>
            สวัสดี{" "}
            {session.user.name ||
              (session.user.email?.split("@")[0] ?? "ผู้ใช้")}{" "}
            <span style={{ color: "var(--df-muted)" }}>·</span>{" "}
            <span style={{ color: "var(--df-accent)" }}>
              {taskRows.length} งาน
            </span>{" "}
            วันนี้
            {urgentTotal > 0 && (
              <>
                <br />
                และ{" "}
                <span style={{ color: "var(--df-danger)" }}>
                  {urgentTotal} เอกสาร
                </span>{" "}
                ต้องต่ออายุภายในเดือนนี้
              </>
            )}
          </>
        }
        actions={
          <>
            <DfButton href="/docuflow/search" variant="ghost">
              <Sparkles size={15} />
              ถาม AI
            </DfButton>
            {adminTier && (
              <DfButton href="/docuflow/documents/upload" variant="brand">
                <Upload size={15} />
                อัปโหลดเอกสาร
              </DfButton>
            )}
          </>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
        className="df-fade-up df-fade-up-100"
      >
        <DfStatCard
          label="เอกสารทั้งหมด"
          value={totalActive.toLocaleString("th-TH")}
          sub="ใช้งานปัจจุบัน"
          icon={<FileText size={17} />}
          tone="ink"
          href="/docuflow/browse"
        />
        <DfStatCard
          label="ใกล้หมดอายุ"
          value={within30}
          sub="ภายใน 30 วันข้างหน้า"
          tone={within30 > 0 ? "warn" : "ink"}
          icon={<Clock size={17} />}
          href="/docuflow/expiry"
        />
        <DfStatCard
          label="หมดอายุแล้ว"
          value={expired}
          sub={expired > 0 ? "ต้องต่ออายุด่วน" : "ไม่มีตกหล่น"}
          tone={expired > 0 ? "danger" : "ink"}
          icon={<AlertTriangle size={17} />}
          href={expired > 0 ? "/docuflow/expiry" : undefined}
        />
        <DfStatCard
          label="รอฉันเซ็น/อนุมัติ"
          value={pendingSignaturesCount}
          sub={
            pendingSignaturesCount > 0
              ? "เปิดดูในแท็บ ลายเซ็น"
              : "ไม่มีคิวค้าง"
          }
          tone={pendingSignaturesCount > 0 ? "accent" : "ink"}
          icon={<PenSquare size={17} />}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: 20,
        }}
        className="df-grid-2col"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <DfCard padding={22} className="df-fade-up df-fade-up-200">
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginBottom: 16,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <DfEyebrow number="01">งานต่อเนื่อง</DfEyebrow>
                <h2
                  className="df-serif"
                  style={{ fontSize: 22, marginTop: 6, marginBottom: 0 }}
                >
                  วันนี้ต้องทำอะไรบ้าง
                </h2>
              </div>
              <DfPill tone="accent" small>
                {taskRows.length} งาน
              </DfPill>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {taskRows.length === 0 ? (
                <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: "var(--df-bg-warm)",
                    color: "var(--df-muted)",
                    fontSize: 14,
                  }}
                >
                  ✨ วันนี้ไม่มีงานเร่งด่วน — ผ่อนคลายได้
                </div>
              ) : (
                taskRows.map((t, i) => (
                  <Link
                    key={i}
                    href={t.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: "var(--df-surface)",
                      border: "1px solid var(--df-line)",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <DfDocIcon
                      tone={{
                        bg:
                          t.badgeTone === "danger"
                            ? "var(--df-danger-soft)"
                            : t.badgeTone === "warn"
                              ? "var(--df-warn-soft)"
                              : "var(--df-bg-warm)",
                        fg:
                          t.badgeTone === "danger"
                            ? "var(--df-danger)"
                            : t.badgeTone === "warn"
                              ? "var(--df-warn)"
                              : "var(--df-muted)",
                      }}
                    >
                      {t.kind === "renew" ? (
                        <Clock size={17} />
                      ) : t.kind === "sign" ? (
                        <PenSquare size={17} />
                      ) : (
                        <Upload size={17} />
                      )}
                    </DfDocIcon>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--df-muted)",
                          marginTop: 2,
                        }}
                      >
                        {t.sub}
                      </div>
                    </div>
                    <DfPill tone={t.badgeTone} small>
                      {t.badge}
                    </DfPill>
                    <ChevronRight
                      size={16}
                      style={{ color: "var(--df-muted-2)" }}
                    />
                  </Link>
                ))
              )}
            </div>
          </DfCard>

          <DfCard padding={22} className="df-fade-up df-fade-up-300">
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginBottom: 12,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <DfEyebrow number="02">ต่ออายุ</DfEyebrow>
                <h2
                  className="df-serif"
                  style={{ fontSize: 22, marginTop: 6, marginBottom: 0 }}
                >
                  เอกสารที่ต้องต่ออายุเร็ว ๆ นี้
                </h2>
              </div>
              <DfButton href="/docuflow/expiry" variant="ghost" size="sm">
                ดูทั้งหมด <ArrowRight size={13} />
              </DfButton>
            </div>
            {renewals.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  borderRadius: 12,
                  background: "var(--df-surface-soft)",
                  color: "var(--df-muted)",
                  textAlign: "center",
                  fontSize: 14,
                }}
              >
                ทุกเอกสารยังมีอายุเหลือมากกว่า 90 วัน
              </div>
            ) : (
              <div>
                {renewals.slice(0, 6).map((r) => {
                  const tone =
                    r.daysUntilExpiry < 0
                      ? "danger"
                      : r.daysUntilExpiry <= 7
                        ? "danger"
                        : r.daysUntilExpiry <= 30
                          ? "warn"
                          : "outline";
                  const label =
                    r.daysUntilExpiry < 0
                      ? `หมดแล้ว ${Math.abs(r.daysUntilExpiry)} วัน`
                      : r.daysUntilExpiry === 0
                        ? "หมดวันนี้"
                        : `เหลือ ${r.daysUntilExpiry} วัน`;
                  return (
                    <Link
                      key={r.id}
                      href={`/docuflow/documents/${r.document.id}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto auto",
                        gap: 14,
                        alignItems: "center",
                        padding: "12px 4px",
                        borderBottom: "1px solid var(--df-line-soft)",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <DfDocIcon>
                        <FileText size={17} />
                      </DfDocIcon>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.document.name}
                        </div>
                        {r.notes && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--df-muted)",
                              marginTop: 2,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.notes}
                          </div>
                        )}
                      </div>
                      <DfPill tone={tone} small>
                        {label}
                      </DfPill>
                      <ChevronRight
                        size={14}
                        style={{ color: "var(--df-muted-2)" }}
                      />
                    </Link>
                  );
                })}
              </div>
            )}
            {within30 > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 14,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "var(--df-bg-warm)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "var(--df-ink-2)",
                  }}
                >
                  <Wallet size={15} />
                  <span>
                    <b>เอกสารต่ออายุภายใน 30 วันข้างหน้า</b>
                  </span>
                </div>
                <div
                  className="df-tnum df-serif"
                  style={{ fontSize: 20, fontWeight: 600 }}
                >
                  {within30} ฉบับ
                </div>
              </div>
            )}
          </DfCard>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <DfCard
            padding={22}
            style={{ background: "linear-gradient(180deg, #FAF6EE, #FFFFFF)" }}
            className="df-fade-up df-fade-up-200"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div>
                <DfEyebrow number="03">ล่าสุด</DfEyebrow>
                <h2
                  className="df-serif"
                  style={{ fontSize: 22, marginTop: 6, marginBottom: 0 }}
                >
                  อัปโหลดล่าสุด
                </h2>
              </div>
              <DfPill tone="brand" small>
                {recent.length} ฉบับ
              </DfPill>
            </div>
            {recent.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  borderRadius: 12,
                  background: "var(--df-surface)",
                  border: "1px solid var(--df-line)",
                  color: "var(--df-muted)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                ยังไม่มีเอกสาร
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recent.slice(0, 5).map((d) => (
                  <Link
                    key={d.id}
                    href={`/docuflow/documents/${d.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      borderRadius: 12,
                      background: "var(--df-surface)",
                      border: "1px solid var(--df-line)",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <DfDocIcon>
                      <FileText size={17} />
                    </DfDocIcon>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {d.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--df-muted)",
                          marginTop: 2,
                        }}
                      >
                        {d.uploadedAt.toLocaleDateString("th-TH", {
                          day: "numeric",
                          month: "short",
                        })}
                      </div>
                    </div>
                    {d.renewal && (
                      <DfPill
                        tone={
                          d.renewal.daysUntilExpiry < 0
                            ? "danger"
                            : d.renewal.daysUntilExpiry <= 30
                              ? "warn"
                              : "outline"
                        }
                        small
                      >
                        {d.renewal.daysUntilExpiry < 0
                          ? "หมดแล้ว"
                          : `${d.renewal.daysUntilExpiry}ว`}
                      </DfPill>
                    )}
                  </Link>
                ))}
              </div>
            )}
            <DfButton
              href="/docuflow/browse"
              variant="ghost"
              size="sm"
              style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
            >
              ดูทั้งหมด <ArrowRight size={13} />
            </DfButton>
          </DfCard>

          <DfCard padding={22} className="df-fade-up df-fade-up-300">
            <DfEyebrow>04 · สุขภาพเอกสาร</DfEyebrow>
            <h2
              className="df-serif"
              style={{ fontSize: 22, marginTop: 6, marginBottom: 4 }}
            >
              สาขาคุณ
            </h2>
            <div
              style={{
                fontSize: 13,
                color: "var(--df-muted)",
                marginBottom: 14,
              }}
            >
              {expired === 0 && critical === 0
                ? "ทุกอย่างเรียบร้อย"
                : `${expired + critical} เอกสารต้องจัดการ`}
            </div>
            <div className="df-bar" style={{ marginBottom: 14, height: 8 }}>
              <i
                style={{
                  width: `${Math.max(
                    20,
                    Math.min(
                      100,
                      Math.round(
                        ((totalActive - within30) / Math.max(1, totalActive)) *
                          100,
                      ),
                    ),
                  )}%`,
                  background:
                    expired > 0
                      ? "var(--df-danger)"
                      : within30 > 0
                        ? "var(--df-warn)"
                        : "var(--df-success)",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Row
                icon={<CheckCircle2 size={14} />}
                tone="success"
                label="ใช้งานครบ"
                value={`${Math.max(0, totalActive - within30 - expired)}`}
              />
              <Row
                icon={<Clock size={14} />}
                tone="warn"
                label="ใกล้หมด (≤ 30 วัน)"
                value={`${within30}`}
              />
              <Row
                icon={<XCircle size={14} />}
                tone="danger"
                label="หมดอายุแล้ว"
                value={`${expired}`}
              />
              <Row
                icon={<AlertTriangle size={14} />}
                tone="outline"
                label="ติดตาม (≤ 90 วัน)"
                value={`${watch}`}
              />
            </div>
            <DfButton
              href="/docuflow/risk"
              variant="ghost"
              size="sm"
              style={{
                marginTop: 12,
                width: "100%",
                justifyContent: "center",
              }}
            >
              ดู Risk dashboard <ArrowRight size={13} />
            </DfButton>
          </DfCard>

          <DfCard
            warm
            padding={18}
            className="df-fade-up df-fade-up-300"
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          >
            <DfDocIcon tone={{ bg: "var(--df-accent)", fg: "#fff" }}>
              <Megaphone size={16} />
            </DfDocIcon>
            <div style={{ flex: 1 }}>
              <h3
                className="df-serif"
                style={{ fontSize: 16, margin: 0, marginBottom: 4 }}
              >
                ประกาศจากบริษัท
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--df-ink-2)",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                อัปโหลดเอกสารผ่าน DocuFlow + AI ช่วยอ่านอัตโนมัติ —
                ใช้เวลาเพียง 3 วินาทีต่อฉบับ
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--df-muted)",
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                {thaiDateLong(new Date())}
              </p>
            </div>
          </DfCard>

          <Link
            href="/docuflow/search"
            style={{
              padding: "14px 18px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #0E1B2C 0%, #1B47B5 100%)",
              color: "#FFF6E5",
              display: "flex",
              alignItems: "center",
              gap: 12,
              textDecoration: "none",
              boxShadow: "var(--df-shadow-blue)",
            }}
            className="df-fade-up df-fade-up-300"
          >
            <Sparkles size={20} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>ค้นหาด้วย AI</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                ถามภาษาธรรมชาติได้เลย เช่น &quot;เอกสารที่หมดอายุก่อน 30 วัน&quot;
              </div>
            </div>
            <Search size={18} />
          </Link>
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

function Row({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: "success" | "warn" | "danger" | "outline";
  label: string;
  value: string;
}) {
  const colorMap = {
    success: "var(--df-success)",
    warn: "var(--df-warn)",
    danger: "var(--df-danger)",
    outline: "var(--df-muted)",
  };
  const bgMap = {
    success: "var(--df-success-soft)",
    warn: "var(--df-warn-soft)",
    danger: "var(--df-danger-soft)",
    outline: "var(--df-bg-warm)",
  };
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          background: bgMap[tone],
          color: colorMap[tone],
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span
        style={{ flex: 1, color: "var(--df-ink-2)", fontWeight: 500 }}
      >
        {label}
      </span>
      <span
        className="df-tnum"
        style={{ fontWeight: 700, color: colorMap[tone] }}
      >
        {value}
      </span>
    </div>
  );
}
