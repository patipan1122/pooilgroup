// DocuFlow · Settings hub
// ────────────────────────────────────────────────────────────────────
// DocuFlow redesign Track A · Item 1. Previously a dead route (404) —
// linked to from documents/page.tsx's "ตั้งค่าประเภทเอกสาร" tile and the
// mobile bottom nav's "ตั้งค่า" tab, both already pointing here.
//
// Gate: requireProgramAdminTier (NOT requireAdminTier). The original
// build-plan doc recommended requireAdminTier on the premise that
// `userIsModuleAdmin` doesn't exist in this codebase — that premise is
// stale (the plan itself flags the worktree as ~1,530 commits behind
// origin/setup, §0.1). In the CURRENT code, every admin-only DocuFlow
// page (documents/upload, vehicles/new, persons, reports, signatures)
// gates with requireProgramAdminTier, which — unlike requireAdminTier —
// also admits a program_admin who's been granted the docuflow module.
// Using requireAdminTier here would have made Settings the one DocuFlow
// admin page a docuflow program_admin can't reach. Matching the REAL
// convention, not the stale plan text.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  Tags,
  CheckSquare,
  Building2,
  Users,
  Bell,
  Building,
  ChevronRight,
  Lock,
  HardDrive,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireProgramAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { getDriveConnection } from "@/lib/chairops/storage/drive";
import {
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
  DfStatCard,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

export default async function DocuFlowSettingsPage() {
  const session = await requireSession();
  requireProgramAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const [activeCount, inactiveCount, driveConn] = await Promise.all([
    prisma.documentType.count({ where: { orgId, isActive: true } }),
    prisma.documentType.count({ where: { orgId, isActive: false } }),
    getDriveConnection(orgId),
  ]);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <DfTopBanner
        breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "ตั้งค่า" }]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>ตั้งค่า DocuFlow</DfEyebrow>}
        title="ศูนย์ตั้งค่า"
        description="จัดการประเภทเอกสาร · Checklist สาขา · ผู้ใช้งาน · การแจ้งเตือน — ทุกอย่างที่ผู้ดูแลระบบต้องใช้"
      />

      <DfSection
        number="01"
        label="ภาพรวม"
        className="df-fade-up df-fade-up-100"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          <DfStatCard
            label="ประเภทเอกสารที่ใช้งานอยู่"
            value={activeCount}
            tone="brand"
            icon={<Tags size={16} />}
            href="/docuflow/settings/document-types"
          />
          <DfStatCard
            label="ปิดใช้งานแล้ว"
            value={inactiveCount}
            sub="ยังกู้คืนได้ในหน้าจัดการ"
            tone="ink"
            icon={<Lock size={16} />}
          />
        </div>
      </DfSection>

      <DfSection
        number="02"
        label="การตั้งค่า"
        title="จัดการโมดูล"
        className="df-fade-up df-fade-up-200"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          <SettingsHubCard
            href="/docuflow/settings/document-types"
            icon={<Tags size={20} />}
            tone="brand"
            title="ประเภทเอกสาร"
            desc="สร้าง/แก้ไขประเภทเอกสารขององค์กร หรือนำเข้าจากรายการมาตรฐาน"
            badge={activeCount > 0 ? `${activeCount} รายการ` : "ยังไม่มี"}
          />
          <SettingsHubCard
            href="/docuflow/checklist"
            icon={<CheckSquare size={20} />}
            tone="success"
            title="Checklist ตามประเภทธุรกิจ"
            desc="เทียบเอกสารที่อัปโหลดแล้วกับรายการที่กฎหมายกำหนด ต่อสาขา/ธุรกิจ"
          />
          <SettingsHubCard
            href="/branches/new"
            icon={<Building2 size={20} />}
            tone="warn"
            title="สร้างสาขา"
            desc="เพิ่มสาขาใหม่เข้าองค์กร (หน้ากลาง ใช้ร่วมกันทุกโปรแกรม)"
          />
          <SettingsHubCard
            href="/users"
            icon={<Users size={20} />}
            tone="ink"
            title="ผู้ใช้งาน & สิทธิ์"
            desc="จัดการผู้ใช้ · กำหนดสิทธิ์แอดมิน (หน้ากลางขององค์กร)"
          />
          <SettingsHubCard
            href="/docuflow/settings/notifications"
            icon={<Bell size={20} />}
            tone="accent"
            title="การแจ้งเตือน"
            desc="ดูสถานะช่องทางแจ้งเตือนของ DocuFlow"
          />
          <DisabledHubCard
            icon={<Building size={20} />}
            title="สร้างบริษัท"
            desc="ยังไม่มีในระบบ — ต้องสร้างข้ามโปรแกรม ไม่ใช่ scope ของ DocuFlow"
          />
          <DriveStatusCard connected={Boolean(driveConn)} rootFolderName={driveConn?.rootFolderName ?? null} />
        </div>
      </DfSection>
    </div>
  );
}

function SettingsHubCard({
  href,
  icon,
  tone,
  title,
  desc,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  tone: "brand" | "success" | "warn" | "ink" | "accent" | "danger";
  title: string;
  desc: string;
  badge?: string;
}) {
  const bgMap: Record<typeof tone, string> = {
    brand: "var(--df-brand-soft)",
    success: "var(--df-success-soft)",
    warn: "var(--df-warn-soft)",
    ink: "var(--df-bg-warm)",
    accent: "var(--df-accent-soft)",
    danger: "var(--df-danger-soft)",
  };
  const fgMap: Record<typeof tone, string> = {
    brand: "var(--df-brand)",
    success: "var(--df-success)",
    warn: "var(--df-warn)",
    ink: "var(--df-ink-2)",
    accent: "var(--df-accent)",
    danger: "var(--df-danger)",
  };

  return (
    <Link
      href={href}
      className="df-card"
      style={{
        padding: 18,
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 11,
          background: bgMap[tone],
          color: fgMap[tone],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--df-ink)" }}>
            {title}
          </span>
          {badge && (
            <DfPill tone="outline" small>
              {badge}
            </DfPill>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--df-muted)", margin: 0, lineHeight: 1.5 }}>
          {desc}
        </p>
      </div>
      <ChevronRight
        size={16}
        style={{ color: "var(--df-muted-2)", flexShrink: 0, marginTop: 4 }}
      />
    </Link>
  );
}

function DisabledHubCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <DfCard
      padding={18}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        border: "1.5px dashed var(--df-line)",
        opacity: 0.65,
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 11,
          background: "var(--df-bg-warm)",
          color: "var(--df-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--df-ink-2)" }}>
            {title}
          </span>
          <DfPill tone="outline" small>
            ยังไม่มีในระบบ
          </DfPill>
        </div>
        <p style={{ fontSize: 12, color: "var(--df-muted)", margin: 0, lineHeight: 1.5 }}>
          {desc}
        </p>
      </div>
    </DfCard>
  );
}

/**
 * Read-only status card — no "connect Drive" action here on purpose.
 * DocuFlow only REUSES the shared Google Drive connection already set up
 * via ChairOps; it does not build its own OAuth flow. If the connection is
 * ever missing, that's fixed at its origin (ChairOps), not duplicated here.
 */
function DriveStatusCard({
  connected,
  rootFolderName,
}: {
  connected: boolean;
  rootFolderName: string | null;
}) {
  return (
    <DfCard
      padding={18}
      style={{ display: "flex", gap: 14, alignItems: "flex-start" }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 11,
          background: connected ? "var(--df-success-soft)" : "var(--df-bg-warm)",
          color: connected ? "var(--df-success)" : "var(--df-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <HardDrive size={20} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--df-ink)" }}>
            Google Drive
          </span>
          <DfPill tone={connected ? "success" : "outline"} small>
            {connected ? "เชื่อมต่อแล้ว" : "ยังไม่ได้เชื่อมต่อ"}
          </DfPill>
        </div>
        <p style={{ fontSize: 12, color: "var(--df-muted)", margin: 0, lineHeight: 1.5 }}>
          {connected
            ? `ส่งออกเอกสารไปที่โฟลเดอร์ "${rootFolderName}" (ใช้การเชื่อมต่อเดียวกับ ChairOps)`
            : "ยังไม่ได้เชื่อมต่อ — เชื่อมต่อได้จากหน้า ChairOps"}
        </p>
      </div>
    </DfCard>
  );
}
