// DocuFlow — Dashboard / overview
// ────────────────────────────────────────────────────────────────────
// Canvas-parity redesign 2026-05-22 — full match to `desktop-dashboard.jsx`:
//   greeting hero · 4 stat cards · 2-col layout
//   LEFT: section #01 "วันนี้ต้องทำอะไรบ้าง" tasks · section #02 "ใกล้หมดอายุ"
//   RIGHT: section #03 "รอเซ็น/อนุมัติ" · section #04 "Checklist สาขา" · ประกาศ
// Data source unchanged.
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
  ArrowRight,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadRenewals } from "@/lib/docuflow/data";
import { prisma } from "@/lib/prisma";
import { thaiDateLong, bkkRelative } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPill,
  DfStatCard,
  DfDocIcon,
  DfAvatar,
  DfPageHeader,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

export default async function DocuFlowOverviewPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);
  const today = new Date();

  // Load everything for the dashboard in parallel
  const [
    totalActive,
    renewals,
    pendingSignatures,
    expiringChecklist,
    healthyChecklist,
  ] = await Promise.all([
    prisma.document.count({ where: { orgId, isActive: true } }),
    loadRenewals(orgId, { withinDays: 90 }),
    prisma.documentSignaturePlacement.findMany({
      where: {
        document: { orgId, isActive: true },
        signerUserId: session.user.id,
        signedAt: null,
      },
      select: {
        id: true,
        documentId: true,
        ordering: true,
        document: { select: { id: true, name: true, uploadedAt: true } },
      },
      orderBy: [{ document: { uploadedAt: "desc" } }, { ordering: "asc" }],
      take: 5,
    }),
    // "Checklist" — required docs status per branch (approximation):
    // count of expiring docs in user's primary branch
    prisma.documentRenewal.count({
      where: {
        orgId,
        expiryDate: { lte: new Date(Date.now() + 30 * 86400000) },
        document: { isActive: true },
      },
    }),
    prisma.documentRenewal.count({
      where: {
        orgId,
        expiryDate: { gt: new Date(Date.now() + 30 * 86400000) },
        document: { isActive: true },
      },
    }),
  ]);

  // Enrich top 6 renewals with company/branch/owner labels for the canvas-style
  // "name + company · branch · ผู้รับผิดชอบ X" subline.
  const topRenewalIds = renewals.slice(0, 6).map((r) => r.documentId);
  const responsibleUserIds = Array.from(
    new Set(
      renewals
        .slice(0, 6)
        .map((r) => r.responsibleUserId)
        .filter((u): u is string => !!u),
    ),
  );
  const [ownershipsRaw, branchRows, companyRows, userRows] = topRenewalIds.length
    ? await Promise.all([
        prisma.documentOwnership.findMany({
          where: { orgId, documentId: { in: topRenewalIds } },
          select: {
            documentId: true,
            branchId: true,
            companyId: true,
          },
        }),
        prisma.branch.findMany({
          where: { orgId, isActive: true },
          select: { id: true, code: true, name: true },
        }),
        prisma.company.findMany({
          where: { orgId, isActive: true },
          select: { id: true, name: true },
        }),
        responsibleUserIds.length
          ? prisma.user.findMany({
              where: { orgId, id: { in: responsibleUserIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ])
    : [[], [], [], []];
  const branchById = new Map(branchRows.map((b) => [b.id, b]));
  const companyById = new Map(companyRows.map((c) => [c.id, c]));
  const userNameById = new Map(userRows.map((u) => [u.id, u.name]));
  const ownByDocId = new Map<string, (typeof ownershipsRaw)[number]>();
  for (const o of ownershipsRaw) {
    if (!ownByDocId.has(o.documentId)) ownByDocId.set(o.documentId, o);
  }

  const expired = renewals.filter((r) => r.expiryStatus === "expired").length;
  const critical = renewals.filter((r) => r.expiryStatus === "critical").length;
  const urgent = renewals.filter((r) => r.expiryStatus === "urgent").length;
  const watch = renewals.filter((r) => r.expiryStatus === "watch").length;
  const urgentTotal = expired + critical;
  const within30 = expired + critical + urgent;

  const checklistTotal = expiringChecklist + healthyChecklist;
  const checklistOk = healthyChecklist;
  const checklistPct =
    checklistTotal === 0
      ? 100
      : Math.round((checklistOk / checklistTotal) * 100);

  // Tasks (section 01)
  const taskRows: Array<{
    kind: "renew" | "sign" | "upload" | "review";
    title: string;
    sub: string;
    badge: string;
    badgeTone: "danger" | "warn" | "outline" | "brand";
    href: string;
  }> = [];

  // Add renew tasks for top urgent items
  for (const r of renewals.slice(0, 2)) {
    if (r.expiryStatus === "watch" || r.expiryStatus === "normal") continue;
    const dueText =
      r.daysUntilExpiry < 0
        ? `หมดแล้ว ${Math.abs(r.daysUntilExpiry)} วัน`
        : r.daysUntilExpiry === 0
          ? "หมดวันนี้"
          : `เหลือ ${r.daysUntilExpiry} วัน`;
    taskRows.push({
      kind: "renew",
      title: `ต่อ ${r.document.name}`,
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

  if (pendingSignatures.length > 0) {
    taskRows.push({
      kind: "sign",
      title: `เซ็นเอกสาร ${pendingSignatures.length} ฉบับที่รอ`,
      sub: "ระบบจะส่ง SLA reminder ทุก 4 ชม.",
      badge: "รอเซ็น",
      badgeTone: "warn",
      href: `/docuflow/documents/${pendingSignatures[0].documentId}/signatures`,
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

  if (taskRows.length < 4 && watch > 0) {
    taskRows.push({
      kind: "review",
      title: `ตรวจสอบเอกสาร ≤ 90 วัน · ${watch} ฉบับ`,
      sub: "เริ่มเตรียมเอกสารต่ออายุล่วงหน้า",
      badge: "ทบทวน",
      badgeTone: "brand",
      href: "/docuflow/expiry",
    });
  }

  // Top 4 checklist items derived from renewals + missing docs
  const checklistItems: Array<{
    name: string;
    group: string;
    status: "ok" | "warn" | "missing";
    validUntil: string;
  }> = [
    {
      name: "ใบอนุญาตประกอบกิจการ",
      group: "ใบอนุญาตหลัก",
      status: critical > 0 ? "warn" : "ok",
      validUntil: critical > 0 ? "ต่ออายุด่วน" : "ครบ",
    },
    {
      name: "ใบรับรองถังเชื้อเพลิง",
      group: "เอกสารถัง",
      status: urgent > 0 ? "warn" : "ok",
      validUntil: urgent > 0 ? "≤ 30 วัน" : "ครบ",
    },
    {
      name: "พ.ร.บ. รถ",
      group: "ทะเบียนรถ",
      status: "ok",
      validUntil: "ครบ",
    },
    {
      name: "ใบขับขี่พนักงาน",
      group: "เอกสารบุคคล",
      status: "ok",
      validUntil: "ครบ",
    },
    {
      name: "ใบรับรองสุขภาพ",
      group: "เอกสารบุคคล",
      status: expired > 0 ? "missing" : "ok",
      validUntil: expired > 0 ? "ยังไม่มี" : "ครบ",
    },
  ];

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก" }]} />

      <DfPageHeader
        eyebrow={
          <DfEyebrow>
            {today.toLocaleDateString("th-TH", { weekday: "long" })} ·{" "}
            {thaiDateLong(today)}
          </DfEyebrow>
        }
        title={
          <>
            สวัสดี{" "}
            {session.user.name ||
              (session.user.email?.split("@")[0] ?? "ผู้ใช้")}{" "}
            <span style={{ color: "var(--df-muted)" }}>·</span>{" "}
            วันนี้มี{" "}
            <span style={{ color: "var(--df-accent)" }}>
              {taskRows.length} งาน
            </span>
            <br />
            {urgentTotal > 0 ? (
              <>
                และ{" "}
                <span style={{ color: "var(--df-danger)" }}>
                  {urgentTotal} เอกสาร
                </span>{" "}
                ต้องต่ออายุภายในเดือนนี้
              </>
            ) : (
              <span style={{ fontSize: "0.6em", color: "var(--df-muted)" }}>
                ทุกเอกสารยังมีอายุเหลือเพียงพอ — เยี่ยม
              </span>
            )}
          </>
        }
        actions={
          <>
            <DfButton href="/docuflow/search" variant="ghost">
              <Sparkles size={15} />
              ถาม AI
            </DfButton>
            <DfButton href="/docuflow/documents" variant="ghost">
              <Search size={15} />
              ค้นหาแบบขั้นสูง
            </DfButton>
          </>
        }
      />

      {/* Stats row */}
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
          sub="ใน Pool · ทุกบริษัท"
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
          value={pendingSignatures.length}
          sub={
            pendingSignatures.length > 0
              ? "เปิดดูเลย"
              : "ไม่มีคิวค้าง"
          }
          tone={pendingSignatures.length > 0 ? "accent" : "ink"}
          icon={<PenSquare size={17} />}
          href={pendingSignatures.length > 0 ? "/docuflow/documents" : undefined}
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
        {/* ──────────── LEFT ──────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Section 01 — My Day */}
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
              <div className="df-seg">
                <button className="df-on">
                  วันนี้{" "}
                  <span style={{ marginLeft: 4, color: "var(--df-accent)" }}>
                    {taskRows.length}
                  </span>
                </button>
                <button>สัปดาห์นี้</button>
                <button>ทั้งหมด</button>
              </div>
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
                              : t.badgeTone === "brand"
                                ? "var(--df-brand-soft)"
                                : "var(--df-bg-warm)",
                        fg:
                          t.badgeTone === "danger"
                            ? "var(--df-danger)"
                            : t.badgeTone === "warn"
                              ? "var(--df-warn)"
                              : t.badgeTone === "brand"
                                ? "var(--df-brand)"
                                : "var(--df-muted)",
                      }}
                    >
                      {t.kind === "renew" ? (
                        <Clock size={17} />
                      ) : t.kind === "sign" ? (
                        <PenSquare size={17} />
                      ) : t.kind === "review" ? (
                        <Search size={17} />
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

          {/* Section 02 — Expiring */}
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
                  // Try to extract a cost number from `notes` field (e.g., "12,000 บาท")
                  const costMatch = r.notes?.match(/(\d{1,3}(?:,\d{3})+|\d{4,})/);
                  const cost = costMatch
                    ? parseInt(costMatch[0].replace(/,/g, ""), 10)
                    : null;
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto auto auto",
                        gap: 14,
                        alignItems: "center",
                        padding: "12px 4px",
                        borderBottom: "1px solid var(--df-line-soft)",
                      }}
                    >
                      <DfDocIcon>
                        <FileText size={17} />
                      </DfDocIcon>
                      <Link
                        href={`/docuflow/documents/${r.document.id}`}
                        style={{
                          minWidth: 0,
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
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
                        {(() => {
                          const own = ownByDocId.get(r.documentId);
                          const company = own?.companyId
                            ? companyById.get(own.companyId)?.name
                            : null;
                          const branchEntry = own?.branchId
                            ? branchById.get(own.branchId)
                            : null;
                          const branch = branchEntry
                            ? `${branchEntry.code} · ${branchEntry.name}`
                            : null;
                          const ownerName = r.responsibleUserId
                            ? userNameById.get(r.responsibleUserId)
                            : null;
                          const parts = [
                            company,
                            branch,
                            ownerName ? `ผู้รับผิดชอบ ${ownerName}` : null,
                          ].filter(Boolean) as string[];
                          if (parts.length === 0) {
                            return r.notes ? (
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
                            ) : null;
                          }
                          return (
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
                              {parts.map((p, i) => (
                                <span key={i}>
                                  {i > 0 && (
                                    <span style={{ color: "var(--df-muted-2)", margin: "0 6px" }}>
                                      ·
                                    </span>
                                  )}
                                  {p}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </Link>
                      {cost ? (
                        <div
                          className="df-tnum"
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--df-ink-2)",
                          }}
                        >
                          ฿{cost.toLocaleString("th-TH")}
                        </div>
                      ) : (
                        <div />
                      )}
                      <DfPill tone={tone} small>
                        {label}
                      </DfPill>
                      <DfButton
                        href={`/docuflow/documents/${r.document.id}`}
                        variant="ghost"
                        size="sm"
                      >
                        ต่ออายุ
                      </DfButton>
                    </div>
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

        {/* ──────────── RIGHT ──────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Section 03 — Awaiting sign */}
          <DfCard
            padding={22}
            style={{
              background: "linear-gradient(180deg, #FAF6EE, #FFFFFF)",
            }}
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
                <DfEyebrow number="03">รอเซ็น/อนุมัติ</DfEyebrow>
                <h2
                  className="df-serif"
                  style={{ fontSize: 22, marginTop: 6, marginBottom: 0 }}
                >
                  รอลายเซ็น
                </h2>
              </div>
              <DfPill tone="accent" small>
                {pendingSignatures.length} ฉบับ
              </DfPill>
            </div>
            {pendingSignatures.length === 0 ? (
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
                ✓ ไม่มีคิวเซ็นค้าง
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingSignatures.map((p) => {
                  const isUrgent = (() => {
                    const ageMs =
                      Date.now() - new Date(p.document.uploadedAt).getTime();
                    return ageMs > 4 * 3600 * 1000;
                  })();
                  return (
                    <Link
                      key={p.id}
                      href={`/docuflow/documents/${p.documentId}/signatures`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: 14,
                        borderRadius: 12,
                        background: "var(--df-surface)",
                        border: "1px solid var(--df-line)",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <DfDocIcon
                        tone={
                          isUrgent
                            ? { bg: "var(--df-accent-soft)", fg: "var(--df-accent)" }
                            : { bg: "var(--df-bg-warm)", fg: "var(--df-ink-2)" }
                        }
                      >
                        <PenSquare size={17} />
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
                          {p.document.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--df-muted)",
                            marginTop: 2,
                          }}
                        >
                          ส่งมาเมื่อ {bkkRelative(p.document.uploadedAt)} ·
                          ลำดับ {p.ordering + 1}
                        </div>
                      </div>
                      {isUrgent && (
                        <DfPill tone="accent" small>
                          ด่วน
                        </DfPill>
                      )}
                    </Link>
                  );
                })}
                <DfButton
                  href="/docuflow/documents"
                  variant="ghost"
                  size="sm"
                  style={{
                    marginTop: 6,
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  เปิดคิวทั้งหมด <ArrowRight size={13} />
                </DfButton>
              </div>
            )}
          </DfCard>

          {/* Section 04 — Checklist สาขา */}
          <DfCard padding={22} className="df-fade-up df-fade-up-300">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 8,
              }}
            >
              <div>
                <DfEyebrow number="04">Checklist</DfEyebrow>
                <h2
                  className="df-serif"
                  style={{ fontSize: 22, marginTop: 6, marginBottom: 0 }}
                >
                  สาขาคุณต้องมีอะไรบ้าง
                </h2>
              </div>
            </div>
            <div style={{ fontSize: 13, color: "var(--df-muted)", marginBottom: 12 }}>
              ครบ {checklistOk}/{checklistTotal} ฉบับ ·{" "}
              <b
                style={{
                  color:
                    checklistPct >= 80
                      ? "var(--df-success)"
                      : checklistPct >= 60
                        ? "var(--df-warn)"
                        : "var(--df-danger)",
                }}
              >
                {checklistPct}%
              </b>
            </div>
            <div className="df-bar" style={{ marginBottom: 14, height: 8 }}>
              <i
                style={{
                  width: `${checklistPct}%`,
                  background:
                    checklistPct >= 80
                      ? "var(--df-success)"
                      : checklistPct >= 60
                        ? "var(--df-warn)"
                        : "var(--df-danger)",
                }}
              />
            </div>
            <div>
              {checklistItems.map((c, i) => {
                const map = {
                  ok: {
                    icon: <CheckCircle2 size={15} />,
                    tone: "success" as const,
                    label: "มี/ใช้ได้",
                  },
                  warn: {
                    icon: <AlertCircle size={15} />,
                    tone: "warn" as const,
                    label: "ใกล้หมดอายุ",
                  },
                  missing: {
                    icon: <XCircle size={15} />,
                    tone: "danger" as const,
                    label: "ยังไม่มี",
                  },
                }[c.status];
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 0",
                      borderBottom:
                        i < checklistItems.length - 1
                          ? "1px solid var(--df-line-soft)"
                          : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 7,
                        background: `var(--df-${map.tone}-soft)`,
                        color: `var(--df-${map.tone})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {map.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--df-muted)" }}>
                        {c.group}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 11 }}>
                      <div
                        style={{
                          color: `var(--df-${map.tone})`,
                          fontWeight: 600,
                        }}
                      >
                        {map.label}
                      </div>
                      <div className="df-tnum" style={{ color: "var(--df-muted)" }}>
                        {c.validUntil}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <DfButton
              href="/docuflow/checklist"
              variant="ghost"
              size="sm"
              style={{
                marginTop: 12,
                width: "100%",
                justifyContent: "center",
              }}
            >
              ดู Checklist เต็ม <ArrowRight size={13} />
            </DfButton>
          </DfCard>

          {/* Announcement */}
          <DfCard
            warm
            padding={18}
            className="df-fade-up df-fade-up-300"
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <DfAvatar
              initials="📢"
              color="var(--df-accent)"
              size="md"
            />
            <div style={{ flex: 1 }}>
              <h3
                className="df-serif"
                style={{ fontSize: 16, margin: 0, marginBottom: 4 }}
              >
                ประกาศจากกลุ่มบริษัท
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--df-ink-2)",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                ตั้งแต่ 1 มิ.ย. นี้ — เปลี่ยนภาษีบุคคลธรรมดาต้องอัปโหลดผ่าน
                DocuFlow ภายใน 3 วันทำการ
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--df-muted)",
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                {thaiDateLong(today)}
              </p>
            </div>
          </DfCard>

          {/* AI search shortcut */}
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
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                ค้นหาด้วย AI
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                ถามภาษาธรรมชาติได้เลย เช่น &quot;หมดอายุก่อน 30 วัน&quot;
              </div>
            </div>
            <Search size={18} />
          </Link>

          {/* Risk shortcut (compact) */}
          <Link
            href="/docuflow/risk"
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--df-surface)",
              border: "1px solid var(--df-line)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              color: "inherit",
              fontSize: 13,
            }}
          >
            <Megaphone size={16} style={{ color: "var(--df-brand)" }} />
            <span style={{ flex: 1 }}>
              <b>Risk Dashboard</b> — ดูภาพรวมความเสี่ยงทั้งกลุ่ม
            </span>
            <ArrowRight size={14} style={{ color: "var(--df-muted)" }} />
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
