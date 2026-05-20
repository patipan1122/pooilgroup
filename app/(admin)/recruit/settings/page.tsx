// /recruit/settings — module settings (read-only info for now)

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Settings, Mail, Shield, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);

  const [postingCount, applicationCount, blacklistCount, recentAiScored] =
    await Promise.all([
      prisma.recruitJobPosting.count({ where: { orgId: session.user.org_id } }),
      prisma.recruitApplication.count({
        where: { orgId: session.user.org_id, draft: false },
      }),
      prisma.recruitBlacklist.count({
        where: { orgId: session.user.org_id, removedAt: null },
      }),
      prisma.recruitApplication.count({
        where: {
          orgId: session.user.org_id,
          aiEvaluatedAt: { not: null },
        },
      }),
    ]);

  return (
    <div className="p-5 sm:p-8 max-w-4xl mx-auto space-y-6">
      <Section
        number="⚙️"
        label="SETTINGS"
        title="ตั้งค่าโปรแกรมรับสมัครพนักงาน"
        description="ภาพรวมการใช้งาน + เอกสาร PDPA + การแจ้งเตือน"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="ประกาศทั้งหมด" value={postingCount} />
          <Stat label="ใบสมัครรับเข้าระบบ" value={applicationCount} />
          <Stat label="AI ประเมินไปแล้ว" value={recentAiScored} />
          <Stat label="Blacklist active" value={blacklistCount} />
        </div>
      </Section>

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
            desc="ส่ง LINE ให้ผู้สมัครแทน Email"
            status="Phase 2"
            statusTone="neutral"
          />
        </div>
      </Section>

      {/* PDPA */}
      <Section number="02" label="PDPA" title="ข้อมูลส่วนบุคคล">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <Row
            icon={<Shield className="size-5" />}
            title="Consent บังคับก่อน submit"
            desc="ผู้สมัครต้องติ๊กยินยอม PDPA ก่อนกดส่งใบสมัคร"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<Shield className="size-5" />}
            title="National ID"
            desc="ไม่เก็บบัตรประชาชนตอนสมัคร · เก็บตอน onboarding offline"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<FileText className="size-5" />}
            title="Retention (อายุข้อมูล)"
            desc="2 ปี หลังไม่ active · auto-delete (รอ cron · ยังไม่ทำ)"
            status="Phase 2"
            statusTone="neutral"
          />
        </div>
      </Section>

      {/* AI */}
      <Section number="03" label="AI" title="ผู้ช่วย AI">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <Row
            icon={<Settings className="size-5" />}
            title="ประเมินด้วย AI"
            desc="กดปุ่มเอง รายคน · ไม่ auto · AI ไม่ดู อายุ/เพศ/รูป (กัน bias)"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<Settings className="size-5" />}
            title="AI Chat (ผู้ช่วย)"
            desc="FAB มุมขวาล่าง · กดเปิดเอง (⌘/)"
            status="ทำงานอยู่"
            statusTone="success"
          />
          <Row
            icon={<Settings className="size-5" />}
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
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
        {label}
      </p>
      <p className="text-3xl font-extrabold tabular-num text-zinc-900 mt-1">
        {value.toLocaleString("th-TH")}
      </p>
    </div>
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
      <span
        className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${toneClass}`}
      >
        {status}
      </span>
    </div>
  );
}
