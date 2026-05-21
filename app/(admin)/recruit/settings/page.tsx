// /recruit/settings — hub page · links to all sub-settings
// Redesigned per Recruit Redesign canvas Section 13

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import {
  Settings as SettingsIcon,
  Mail,
  Shield,
  FileText,
  ChevronRight,
  Bolt,
  Trash2,
  Sparkles,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);

  const [postingCount, applicationCount, blacklistCount, recentAiScored, rulesCount, pendingErasure] =
    await Promise.all([
      prisma.recruitJobPosting.count({ where: { orgId: session.user.org_id } }),
      prisma.recruitApplication.count({
        where: { orgId: session.user.org_id, draft: false },
      }),
      prisma.recruitBlacklist.count({
        where: { orgId: session.user.org_id, removedAt: null },
      }),
      prisma.recruitApplication.count({
        where: { orgId: session.user.org_id, aiEvaluatedAt: { not: null } },
      }),
      prisma.recruitScreeningRule.count({
        where: { orgId: session.user.org_id, enabled: true },
      }),
      prisma.recruitErasureRequest.count({
        where: { orgId: session.user.org_id, status: "PENDING" },
      }),
    ]);

  return (
    <div className="p-5 sm:p-8 max-w-5xl mx-auto space-y-6">
      <Section
        number="13"
        label="SETTINGS"
        title="ตั้งค่าโปรแกรมรับสมัครพนักงาน"
        description="ดูภาพรวม + การตั้งค่าทั้งหมดที่นี่"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="ประกาศทั้งหมด" value={postingCount} />
          <Stat label="ใบสมัครรับเข้าระบบ" value={applicationCount} />
          <Stat label="AI ประเมินไปแล้ว" value={recentAiScored} />
          <Stat label="Blacklist ใช้งาน" value={blacklistCount} />
        </div>
      </Section>

      {/* Big cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SettingsCard
          href="/recruit/settings/pdpa"
          Icon={Shield}
          title="PDPA Compliance"
          desc="ตรวจ checklist · ดู audit log · แนะนำลบข้อมูลเก่า"
          tone="success"
        />
        <SettingsCard
          href="/recruit/settings/erasure-requests"
          Icon={Trash2}
          title="คำขอลบข้อมูล"
          desc="คำขอจากผู้สมัครให้ลบข้อมูล (PDPA right)"
          tone="danger"
          badge={pendingErasure > 0 ? `${pendingErasure} รอ` : undefined}
        />
        <SettingsCard
          href="/recruit/auto-rules"
          Icon={Bolt}
          title="กฎคัดอัตโนมัติ"
          desc="ตั้งเงื่อนไข → ระบบทำให้ (เช่น AI ≥ 85 → คัดผ่าน)"
          tone="warning"
          badge={rulesCount > 0 ? `${rulesCount} กฎ` : undefined}
        />
        <SettingsCard
          href="/recruit/referrals"
          Icon={Users}
          title="โปรแกรมแนะนำเพื่อน"
          desc="พนักงานชวนเพื่อนสมัคร · ติด UTM + จ่ายโบนัสเมื่อรับเข้า"
          tone="purple"
        />
        <SettingsCard
          href="/recruit/settings/permissions"
          Icon={Shield}
          title="สิทธิการใช้งาน"
          desc="role → ความสามารถ matrix · ดูว่า role ไหนทำอะไรได้"
          tone="success"
        />
      </div>

      {/* Notifications */}
      <Section number="01" label="NOTIFICATIONS" title="การแจ้งเตือน">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <Row
            icon={<Mail className="size-5" />}
            title="Email อัตโนมัติ"
            desc="ส่งให้ผู้สมัครทุกครั้งที่ HR เปลี่ยน status (รับใบ → คัดกรอง → สัมภาษณ์ → ...)"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<Mail className="size-5" />}
            title="LINE OA"
            desc="ส่ง LINE ให้ผู้สมัครแทน Email · ต้องตั้งค่า LINE Developers + Channel Token"
            status="คิวพร้อม (Phase 2)"
            statusTone="warning"
          />
          <Row
            icon={<Mail className="size-5" />}
            title="SMS gateway"
            desc="ส่ง SMS แจ้งสถานะ · ต้องตั้งค่า Twilio หรือ SMS Thai provider"
            status="คิวพร้อม (Phase 2)"
            statusTone="warning"
          />
        </div>
      </Section>

      {/* AI */}
      <Section number="02" label="AI" title="ผู้ช่วย AI">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <Row
            icon={<Sparkles className="size-5" />}
            title="ประเมินด้วย AI"
            desc="กดปุ่มเอง รายคน · ไม่ auto · AI ไม่ดู อายุ/เพศ/รูป (กัน bias)"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<SettingsIcon className="size-5" />}
            title="AI Chat (ผู้ช่วย)"
            desc="FAB มุมขวาล่าง · กดเปิดเอง"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<FileText className="size-5" />}
            title="Budget Cap"
            desc="30 AI calls / วัน · default · ปรับเองได้ใน Phase 2"
            status="Default"
            statusTone="neutral"
          />
        </div>
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500 font-bold">{label}</p>
      <p className="text-3xl font-extrabold tabular-num text-zinc-900 mt-1">
        {value.toLocaleString("th-TH")}
      </p>
    </div>
  );
}

function SettingsCard({
  href,
  Icon,
  title,
  desc,
  tone,
  badge,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  tone: "success" | "danger" | "warning" | "purple";
  badge?: string;
}) {
  const toneCls = {
    success: "border-green-200 bg-gradient-to-br from-green-50 to-white text-green-700",
    danger: "border-red-200 bg-gradient-to-br from-red-50 to-white text-red-700",
    warning: "border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-700",
    purple: "border-purple-200 bg-gradient-to-br from-purple-50 to-white text-purple-700",
  }[tone];
  const iconBg = {
    success: "bg-green-100",
    danger: "bg-red-100",
    warning: "bg-amber-100",
    purple: "bg-purple-100",
  }[tone];

  return (
    <Link
      href={href}
      className={`block rounded-2xl border-2 p-5 hover:shadow-md transition-all group ${toneCls}`}
    >
      <div className="flex items-center gap-3">
        <div className={`size-12 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
          <Icon className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-zinc-900 text-base group-hover:underline">{title}</p>
            {badge && (
              <span className="text-[11px] font-bold bg-white px-2 py-0.5 rounded-full">{badge}</span>
            )}
          </div>
          <p className="text-xs text-zinc-700 mt-1">{desc}</p>
        </div>
        <ChevronRight className="size-5 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

function Row({
  icon,
  title,
  desc,
  status,
  statusTone,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: string;
  statusTone: "success" | "warning" | "neutral";
}) {
  const toneClass =
    statusTone === "success"
      ? "bg-green-50 text-green-700"
      : statusTone === "warning"
        ? "bg-amber-50 text-amber-700"
        : "bg-zinc-100 text-zinc-700";
  return (
    <div className="flex items-start gap-3">
      <div className="size-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-zinc-900 text-sm">{title}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
      </div>
      <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${toneClass}`}>
        {status}
      </span>
    </div>
  );
}
