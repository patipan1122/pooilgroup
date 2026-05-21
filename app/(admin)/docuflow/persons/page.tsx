// DocuFlow · Person docs dashboard — drivers + staff personal docs
// Sensitive (license, health, training, ID) — admin tier only
// Server component · sort by expiring desc

import Link from "next/link";
import { UserCircle2, ArrowLeft, Users, AlertTriangle, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { thaiDateLong } from "@/lib/utils/format";
import { prisma } from "@/lib/prisma";
import { classifyExpiry, type ExpiryStatus } from "@/lib/vehicles/data";
import {
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
  DfStatCard,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  admin: "Admin",
  area_manager: "Area Manager",
  branch_manager: "Branch Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

import { PERSON_DOC_TYPES } from "./types";

interface PersonRowVm {
  userId: string;
  name: string;
  role: string;
  roleLabel: string;
  docCount: number;
  /** Required types present (denominator = PERSON_DOC_TYPES.length) */
  completionPct: number;
  expiringCount: number;
  worstStatus: ExpiryStatus | "missing";
}

const STATUS_RANK: Record<ExpiryStatus | "missing", number> = {
  expired: 0,
  critical: 1,
  urgent: 2,
  watch: 3,
  no_expiry: 4,
  ok: 5,
  missing: 6,
};

const WORST_BADGE: Record<
  ExpiryStatus | "missing",
  { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  expired: { tone: "danger", label: "หมดอายุ" },
  critical: { tone: "danger", label: "≤7 วัน" },
  urgent: { tone: "warning", label: "≤30 วัน" },
  watch: { tone: "info", label: "≤90 วัน" },
  ok: { tone: "success", label: "ปลอดภัย" },
  no_expiry: { tone: "neutral", label: "ไม่ระบุ" },
  missing: { tone: "neutral", label: "ไม่มีเอกสาร" },
};

export default async function DocuFlowPersonsPage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  // Pull all active users + their person docs
  const [users, personDocs] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: "asc" }],
    }),
    prisma.personDocument.findMany({
      where: { orgId },
      select: {
        userId: true,
        docType: true,
        expiryDate: true,
      },
    }),
  ]);

  // Group docs by user
  const docsByUser = new Map<
    string,
    Array<{ docType: string; expiryDate: Date | null }>
  >();
  for (const d of personDocs) {
    if (!docsByUser.has(d.userId)) docsByUser.set(d.userId, []);
    docsByUser.get(d.userId)!.push({
      docType: d.docType,
      expiryDate: d.expiryDate,
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: PersonRowVm[] = users.map((u) => {
    const docs = docsByUser.get(u.id) ?? [];
    const typesPresent = new Set(docs.map((d) => d.docType));
    const requiredPresent = PERSON_DOC_TYPES.filter((t) =>
      typesPresent.has(t),
    ).length;
    const completionPct = Math.round(
      (requiredPresent / PERSON_DOC_TYPES.length) * 100,
    );

    // Compute worst status across all docs
    let worst: ExpiryStatus | "missing" =
      docs.length === 0 ? "missing" : "ok";
    let expiringCount = 0;
    for (const d of docs) {
      if (!d.expiryDate) continue;
      const exp = new Date(d.expiryDate);
      exp.setHours(0, 0, 0, 0);
      const days = Math.floor(
        (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      const status = classifyExpiry(days);
      if (status === "expired" || status === "critical" || status === "urgent") {
        expiringCount += 1;
      }
      if (STATUS_RANK[status] < STATUS_RANK[worst]) worst = status;
    }

    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role] ?? u.role,
      docCount: docs.length,
      completionPct,
      expiringCount,
      worstStatus: worst,
    };
  });

  // Sort by expiringCount desc, then worst status, then name
  rows.sort((a, b) => {
    if (b.expiringCount !== a.expiringCount) {
      return b.expiringCount - a.expiringCount;
    }
    if (STATUS_RANK[a.worstStatus] !== STATUS_RANK[b.worstStatus]) {
      return STATUS_RANK[a.worstStatus] - STATUS_RANK[b.worstStatus];
    }
    return a.name.localeCompare(b.name, "th");
  });

  const totalExpiring = rows.reduce((s, r) => s + r.expiringCount, 0);
  const totalWithDocs = rows.filter((r) => r.docCount > 0).length;

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
        eyebrow={<DfEyebrow>เอกสารบุคคล · พนักงาน + คนขับ</DfEyebrow>}
        title={
          <>
            <span style={{ color: "var(--df-brand)" }}>{rows.length}</span> คน
            {totalExpiring > 0 && (
              <>
                <br />
                <span style={{ color: "var(--df-danger)" }}>
                  {totalExpiring} ฉบับใกล้หมดอายุ
                </span>
              </>
            )}
          </>
        }
        description={`${thaiDateLong(new Date())} · ใบขับขี่ · ใบรับรองสุขภาพ · บัตร ปชช.`}
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
          label="พนักงานทั้งหมด"
          value={rows.length}
          tone="ink"
          icon={<Users size={17} />}
        />
        <DfStatCard
          label="มีเอกสาร"
          value={totalWithDocs}
          tone="success"
          icon={<FileText size={17} />}
        />
        <DfStatCard
          label="ใกล้หมดอายุ"
          value={totalExpiring}
          tone={totalExpiring > 0 ? "warn" : "ink"}
          icon={<AlertTriangle size={17} />}
        />
        <DfStatCard
          label="ยังไม่มีเอกสาร"
          value={Math.max(0, rows.length - totalWithDocs)}
          tone={rows.length - totalWithDocs > 0 ? "danger" : "ink"}
          icon={<UserCircle2 size={17} />}
        />
      </div>

      <DfSection
        number="01"
        label="พนักงาน + คนขับ"
        description="เรียงตามจำนวนเอกสารใกล้หมดอายุ"
        className="df-fade-up df-fade-up-200"
      >
        {rows.length === 0 ? (
          <DfCard padding={36} style={{ textAlign: "center" }}>
            <UserCircle2
              size={32}
              style={{ color: "var(--df-muted)", margin: "0 auto 12px" }}
            />
            <h3
              className="df-serif"
              style={{ fontSize: 18, marginTop: 0, marginBottom: 8 }}
            >
              ยังไม่มีพนักงาน
            </h3>
            <p style={{ fontSize: 13, color: "var(--df-muted)" }}>
              เพิ่มพนักงานในเมนู &lsquo;ผู้ใช้งาน&rsquo; ก่อน แล้วกลับมาที่นี่
            </p>
          </DfCard>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 14,
            }}
          >
            {rows.map((r) => (
              <PersonRow key={r.userId} row={r} />
            ))}
          </div>
        )}
      </DfSection>
    </div>
  );
}

function PersonRow({ row }: { row: PersonRowVm }) {
  const badge = WORST_BADGE[row.worstStatus];
  const tone =
    badge.tone === "danger"
      ? "danger"
      : badge.tone === "warning"
        ? "warn"
        : badge.tone === "success"
          ? "success"
          : badge.tone === "info"
            ? "brand"
            : "outline";
  return (
    <Link
      href={`/docuflow/persons/${row.userId}`}
      className="df-card"
      style={{
        padding: 16,
        textDecoration: "none",
        color: "inherit",
        display: "block",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "var(--df-brand-soft)",
              color: "var(--df-brand)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--df-surface)",
              flexShrink: 0,
            }}
          >
            <UserCircle2 size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--df-muted)", marginTop: 2 }}>
              {row.roleLabel}
            </div>
          </div>
        </div>
        <DfPill tone={tone} small>
          {badge.label}
        </DfPill>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--df-muted)",
            marginBottom: 4,
          }}
        >
          <span>ความครบของเอกสาร</span>
          <span className="df-tnum" style={{ fontWeight: 600, color: "var(--df-ink-2)" }}>
            {row.completionPct}% · {row.docCount} ฉบับ
          </span>
        </div>
        <div className="df-bar" style={{ height: 6 }}>
          <i
            style={{
              width: `${row.completionPct}%`,
              background:
                row.completionPct >= 75
                  ? "var(--df-success)"
                  : row.completionPct >= 50
                    ? "var(--df-warn)"
                    : "var(--df-danger)",
            }}
          />
        </div>
      </div>

      {row.expiringCount > 0 && (
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--df-danger)",
            marginTop: 10,
            marginBottom: 0,
          }}
        >
          ⚠️ ใกล้หมดอายุ {row.expiringCount} ฉบับ
        </p>
      )}
    </Link>
  );
}
