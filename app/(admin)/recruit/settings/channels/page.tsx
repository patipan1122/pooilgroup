// /recruit/settings/channels — Omnichannel inbox setup
// Connect LINE OA + Facebook Pages so applicant DMs land in /recruit/messages
//
// CEO 2026-05-23: "คนสมัครทักมาใน line oa แล้วมาโผล่ในนี้เลย" + multi-account

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { listChannels } from "@/lib/recruit/channel-actions";
import { Section } from "@/components/ui/section";
import { ChannelsManager } from "@/components/recruit/channels-manager";
import { MessageCircle, ShieldCheck, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ChannelsSettingsPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);

  const channels = await listChannels();

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="13.3"
        label="OMNICHANNEL INBOX"
        title="เชื่อม LINE OA / Facebook Page"
        description="ผู้สมัครทักมาทาง LINE หรือ FB → มาโผล่ใน /recruit/messages · รวมทุกช่องทาง · รองรับหลายบัญชี"
      >
        {/* Status banner */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-2xl bg-gradient-to-br from-[var(--color-brand-50)] to-white border border-[var(--color-brand-200)] p-4 flex items-start gap-3">
            <MessageCircle className="size-5 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
            <div className="text-xs text-zinc-700 leading-relaxed">
              <p className="font-bold text-[var(--color-brand-900)] mb-1">หลักการ</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>1 องค์กรเชื่อมได้หลาย LINE OA + หลาย FB Page</li>
                <li>แต่ละ channel มี webhook URL เฉพาะ · พาสต์ใน LINE Dev Console / FB App</li>
                <li>ข้อความ inbound → สร้าง applicant ถ้าใหม่ + ผูกเข้า thread</li>
                <li>ตอบกลับใน /recruit/messages → ส่งต่อช่องเดิมที่ผู้สมัครทักมา</li>
              </ul>
            </div>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white border border-amber-200 p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-zinc-700 leading-relaxed">
              <p className="font-bold text-amber-900 mb-1">สถานะปัจจุบัน (2026-05-23)</p>
              <p>
                ระบบ <b>เชื่อม channel + กำหนด webhook URL ได้แล้ว</b> ·
                <b>ยังไม่ได้ตั้ง LINE Developer Console + FB App จริง</b> ·
                ต้องการอีก ~3-5 วันเพื่อ wire OAuth flow + signature
                verification + bot reply API ครบ · ดู{" "}
                <code className="font-mono text-[10px] bg-amber-100 px-1.5 py-0.5 rounded">
                  docs/RECRUIT_OMNICHAT_PLAN.md
                </code>
              </p>
            </div>
          </div>
        </div>

        <ChannelsManager initialChannels={channels} />

        {/* PDPA note */}
        <div className="mt-6 rounded-2xl bg-zinc-50 border border-zinc-200 p-4 flex items-start gap-3">
          <ShieldCheck className="size-5 text-zinc-600 shrink-0 mt-0.5" />
          <div className="text-xs text-zinc-600 leading-relaxed">
            <p className="font-bold text-zinc-900 mb-1">ความปลอดภัย</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Webhook signature ของแต่ละ channel verify ด้วย secret เฉพาะตัว</li>
              <li>Access token เก็บแบบ encrypted (envelope key จาก env)</li>
              <li>RLS บังคับ org_id match · cross-tenant access ถูกบล็อก</li>
              <li>ข้อความ inbound บันทึกใน <code>recruit_messages</code> table เดียวกับ INAPP</li>
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}
