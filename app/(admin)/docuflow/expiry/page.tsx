// DocuFlow — Expiry Dashboard
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopRenewal + DesktopCalendar canvas:
//   stat strip + bucket cards (4 tones) + side calendar visualization.
// Data layer unchanged.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  Clock,
  AlertCircle,
  AlertTriangle,
  Calendar,
  ChevronRight,
  Wallet,
  ArrowLeft,
  Bell,
  Download,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadRenewals } from "@/lib/docuflow/data";
import type { ExpiryStatus } from "@/lib/docuflow/expiry";
import { prisma } from "@/lib/prisma";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { DocumentFilters } from "@/components/docuflow/document-filters";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfStatCard,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

interface SP {
  company?: string;
  branch?: string;
  type?: string;
}

interface BucketDef {
  status: ExpiryStatus;
  label: string;
  description: string;
  Icon: typeof Clock;
  tone: "danger" | "warn" | "outline" | "success";
}

const BUCKETS: BucketDef[] = [
  {
    status: "expired",
    label: "หมดแล้ว",
    description: "เอกสารหมดอายุแล้ว — ต้องต่อด่วน",
    Icon: AlertCircle,
    tone: "danger",
  },
  {
    status: "critical",
    label: "วิกฤต ≤ 7 วัน",
    description: "หมดในสัปดาห์หน้า",
    Icon: AlertTriangle,
    tone: "danger",
  },
  {
    status: "urgent",
    label: "เร่งด่วน ≤ 30 วัน",
    description: "หมดภายในเดือน — เริ่มดำเนินการ",
    Icon: Clock,
    tone: "warn",
  },
  {
    status: "watch",
    label: "เฝ้าระวัง ≤ 90 วัน",
    description: "เริ่มเตรียมต่ออายุ",
    Icon: Calendar,
    tone: "outline",
  },
];

export default async function ExpiryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const sp = await searchParams;

  const filterCompany = sp.company || "";
  const filterBranch = sp.branch || "";
  const filterType = sp.type || "";

  const [renewals, companies, branches] = await Promise.all([
    loadRenewals(orgId, { withinDays: 90 }),
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.branch.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        businessType: true,
        companyId: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const docIds = renewals.map((r) => r.documentId);
  const ownerships = docIds.length
    ? await prisma.documentOwnership.findMany({
        where: { orgId, documentId: { in: docIds } },
        select: {
          documentId: true,
          level: true,
          companyId: true,
          branchId: true,
          businessType: true,
        },
      })
    : [];
  const ownershipByDoc = new Map<string, typeof ownerships>();
  for (const o of ownerships) {
    const list = ownershipByDoc.get(o.documentId) ?? [];
    list.push(o);
    ownershipByDoc.set(o.documentId, list);
  }

  const filtered = renewals.filter((r) => {
    const owners = ownershipByDoc.get(r.documentId) ?? [];
    if (filterCompany) {
      const ok = owners.some((o) => o.companyId === filterCompany);
      if (!ok) return false;
    }
    if (filterBranch) {
      const ok = owners.some((o) => o.branchId === filterBranch);
      if (!ok) return false;
    }
    if (filterType) {
      const ok = owners.some((o) => o.businessType === filterType);
      if (!ok) return false;
    }
    return true;
  });

  const grouped: Record<ExpiryStatus, typeof filtered> = {
    expired: [],
    critical: [],
    urgent: [],
    watch: [],
    normal: [],
  };
  for (const r of filtered) grouped[r.expiryStatus].push(r);

  const expired = grouped.expired.length;
  const critical = grouped.critical.length;
  const urgent = grouped.urgent.length;
  const watch = grouped.watch.length;
  const totalUrgent = expired + critical;
  const within30 = expired + critical + urgent;

  const companyChips = companies.map((c) => ({ value: c.id, label: c.name }));
  const branchChips = branches
    .filter((b) => !filterCompany || b.companyId === filterCompany)
    .slice(0, 30)
    .map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }));
  const typeChips = Array.from(new Set(branches.map((b) => b.businessType))).map(
    (t) => {
      const cfg = BUSINESS_TYPES[t];
      return { value: t, label: cfg ? `${cfg.emoji} ${cfg.label}` : t };
    },
  );
  const preserveFor = (key: string) => {
    const p: Record<string, string> = {};
    if (filterCompany && key !== "company") p.company = filterCompany;
    if (filterBranch && key !== "branch") p.branch = filterBranch;
    if (filterType && key !== "type") p.type = filterType;
    return p;
  };

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();
  const eventsByDay = new Map<number, typeof filtered>();
  for (const r of filtered) {
    const d = new Date(r.expiryDate);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      const list = eventsByDay.get(day) ?? [];
      list.push(r);
      eventsByDay.set(day, list);
    }
  }
  const weekDays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const monthName = now.toLocaleDateString("th-TH", {
    month: "long",
    year: "numeric",
  });

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <Link
        href="/docuflow"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับ DocuFlow
      </Link>

      <DfPageHeader
        eyebrow={<DfEyebrow>ใกล้หมดอายุ · ปฏิทินต่ออายุ</DfEyebrow>}
        title={
          <>
            <span style={{ color: "var(--df-muted)" }}>{monthName}</span>
            {totalUrgent > 0 && (
              <>
                <br />
                <span style={{ color: "var(--df-danger)" }}>{totalUrgent}</span>{" "}
                เอกสารต้องต่ออายุด่วน
              </>
            )}
          </>
        }
        description={`${filtered.length.toLocaleString("th-TH")} เอกสารใกล้หมดอายุ`}
        actions={
          <>
            <DfButton variant="ghost">
              <Download size={14} />
              Export ปฏิทิน
            </DfButton>
            <DfButton variant="brand" href="/docuflow/calendar">
              <Bell size={14} />
              เปิดปฏิทินเต็ม
            </DfButton>
          </>
        }
      />

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
          value={eventsByDay.get(today)?.length ?? 0}
          tone={(eventsByDay.get(today)?.length ?? 0) > 0 ? "danger" : "ink"}
          icon={<Clock size={17} />}
        />
        <DfStatCard
          label="หมดแล้ว"
          value={expired}
          tone={expired > 0 ? "danger" : "ink"}
          icon={<AlertCircle size={17} />}
        />
        <DfStatCard
          label="≤ 30 วัน"
          value={within30}
          tone={within30 > 0 ? "warn" : "ink"}
          icon={<Clock size={17} />}
        />
        <DfStatCard
          label="≤ 90 วัน"
          value={watch}
          tone="brand"
          icon={<Calendar size={17} />}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)",
          gap: 20,
        }}
        className="df-grid-2col"
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          className="df-fade-up df-fade-up-200"
        >
          {filtered.length === 0 ? (
            <DfCard padding={36} style={{ textAlign: "center" }}>
              <DfEyebrow>ไม่มีเอกสารใกล้หมด</DfEyebrow>
              <h3
                className="df-serif"
                style={{ fontSize: 22, marginTop: 12, marginBottom: 8 }}
              >
                ทุกเอกสารยังเหลืออายุเกิน 90 วัน
              </h3>
              <p
                style={{
                  color: "var(--df-muted)",
                  fontSize: 13,
                  marginTop: 0,
                  marginBottom: 16,
                }}
              >
                เยี่ยม! ระบบจะแจ้งเตือนเมื่อมีเอกสารใกล้หมดอายุ
              </p>
              <DfButton href="/docuflow/browse" variant="ghost">
                ดูเอกสารทั้งหมด <ChevronRight size={13} />
              </DfButton>
            </DfCard>
          ) : (
            BUCKETS.map((b) => {
              const list = grouped[b.status];
              if (list.length === 0) return null;
              const Icon = b.Icon;
              const toneBg: Record<typeof b.tone, string> = {
                danger: "var(--df-danger-soft)",
                warn: "var(--df-warn-soft)",
                outline: "var(--df-bg-warm)",
                success: "var(--df-success-soft)",
              };
              const toneFg: Record<typeof b.tone, string> = {
                danger: "var(--df-danger)",
                warn: "var(--df-warn)",
                outline: "var(--df-muted)",
                success: "var(--df-success)",
              };
              return (
                <DfCard key={b.status} padding={0}>
                  <div
                    style={{
                      padding: "16px 20px",
                      borderBottom: "1px solid var(--df-line)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          background: toneBg[b.tone],
                          color: toneFg[b.tone],
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon size={20} />
                      </span>
                      <div>
                        <h3
                          className="df-serif"
                          style={{ fontSize: 18, margin: 0 }}
                        >
                          {b.label}
                        </h3>
                        <p
                          style={{
                            fontSize: 12,
                            color: "var(--df-muted)",
                            margin: 0,
                            marginTop: 2,
                          }}
                        >
                          {b.description}
                        </p>
                      </div>
                    </div>
                    <span
                      className="df-tnum df-serif"
                      style={{ fontSize: 28, fontWeight: 600, color: toneFg[b.tone] }}
                    >
                      {list.length}
                    </span>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {list.map((r) => {
                      const label =
                        r.daysUntilExpiry < 0
                          ? `หมดแล้ว ${Math.abs(r.daysUntilExpiry)} วัน`
                          : r.daysUntilExpiry === 0
                            ? "หมดวันนี้"
                            : `เหลือ ${r.daysUntilExpiry} วัน`;
                      return (
                        <li
                          key={r.id}
                          style={{
                            padding: "12px 20px",
                            display: "grid",
                            gridTemplateColumns: "1fr auto auto",
                            gap: 12,
                            alignItems: "center",
                            borderBottom: "1px solid var(--df-line-soft)",
                          }}
                        >
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
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--df-muted)",
                                marginTop: 2,
                              }}
                            >
                              หมด {thaiDateLong(r.expiryDate)}
                            </div>
                          </Link>
                          <DfPill tone={b.tone} small>
                            {label}
                          </DfPill>
                          <DfButton
                            href={`/docuflow/documents/${r.document.id}`}
                            variant="brand"
                            size="sm"
                          >
                            ต่ออายุ
                          </DfButton>
                        </li>
                      );
                    })}
                  </ul>
                </DfCard>
              );
            })
          )}
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          className="df-fade-up df-fade-up-300"
        >
          <DfCard padding={18}>
            <DfEyebrow>ปฏิทิน · เดือนนี้</DfEyebrow>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                marginTop: 12,
                marginBottom: 6,
              }}
            >
              {weekDays.map((d) => (
                <div
                  key={d}
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--df-muted)",
                    letterSpacing: "0.05em",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 2,
              }}
            >
              {Array.from({ length: firstDow }).map((_, i) => (
                <div key={`empty-${i}`} style={{ aspectRatio: 1 }} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday = day === today;
                const evs = eventsByDay.get(day) ?? [];
                const evCount = Math.min(evs.length, 3);
                const tone = evs.some(
                  (r) =>
                    r.expiryStatus === "expired" ||
                    r.expiryStatus === "critical",
                )
                  ? "var(--df-danger)"
                  : evs.some((r) => r.expiryStatus === "urgent")
                    ? "var(--df-warn)"
                    : "var(--df-brand)";
                return (
                  <div
                    key={day}
                    style={{
                      aspectRatio: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isToday ? "var(--df-accent)" : "transparent",
                      color: isToday ? "#fff" : "var(--df-ink)",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                    }}
                    className="df-tnum"
                  >
                    {day}
                    {evCount > 0 && (
                      <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                        {Array.from({ length: evCount }).map((_, k) => (
                          <div
                            key={k}
                            style={{
                              width: 4,
                              height: 4,
                              borderRadius: 99,
                              background: isToday ? "#fff" : tone,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </DfCard>

          <DfCard padding={18}>
            <DfEyebrow>ตัวกรอง</DfEyebrow>
            <div style={{ marginTop: 12 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  marginBottom: 6,
                }}
              >
                บริษัท
              </p>
              <DocumentFilters
                paramKey="company"
                current={filterCompany}
                chips={companyChips}
                preserve={preserveFor("company")}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  marginBottom: 6,
                }}
              >
                ประเภทธุรกิจ
              </p>
              <DocumentFilters
                paramKey="type"
                current={filterType}
                chips={typeChips}
                preserve={preserveFor("type")}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  marginBottom: 6,
                }}
              >
                สาขา {filterCompany && "(ในบริษัทที่เลือก)"}
              </p>
              <DocumentFilters
                paramKey="branch"
                current={filterBranch}
                chips={branchChips}
                preserve={preserveFor("branch")}
              />
            </div>
          </DfCard>

          {within30 > 0 && (
            <DfCard
              padding={16}
              style={{
                background: "linear-gradient(135deg, #0E1B2C 0%, #1B47B5 100%)",
                border: "none",
                color: "#FFF6E5",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Wallet size={20} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    เอกสารต่ออายุ 30 วันข้างหน้า
                  </div>
                  <div
                    className="df-tnum df-serif"
                    style={{ fontSize: 22, fontWeight: 600 }}
                  >
                    {within30} ฉบับ
                  </div>
                </div>
              </div>
            </DfCard>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
