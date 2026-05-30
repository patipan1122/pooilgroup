// /inbox/settings/channels — Unified omnichannel inbox setup
// Connect LINE OA + Facebook Pages so customer DMs land in /inbox.
// Mirrors the Recruit channel UX, plus a "ธุรกิจ" (businessTag) dropdown and a
// per-channel bot on/off toggle (shown only for bot-capable channels).

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/module-access";
import { listChannels } from "@/lib/inbox/channel-actions";
import { INBOX_BUSINESSES } from "@/lib/inbox/business";
import { Section } from "@/components/ui/section";
import { ChannelsManager } from "./_components/channels-manager";
import { MessageCircle, ShieldCheck, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InboxChannelsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ fb_error?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) redirect("/403");

  const params = await searchParams;
  const channels = await listChannels();

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="IB.1"
        label="OMNICHANNEL INBOX"
        title="เชื่อม LINE OA / Facebook Page"
        description="ลูกค้าทักมาทาง LINE หรือ FB → มาโผล่รวมกันใน /inbox · รองรับหลายบัญชี · เปิดบอทตอบอัตโนมัติได้ (เฉพาะธุรกิจที่รองรับ)"
      >
        {params.fb_error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-bold">เชื่อม Facebook ไม่สำเร็จ</p>
            <p className="text-xs">{params.fb_error}</p>
          </div>
        )}
        {/* Status banner */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-2xl bg-gradient-to-br from-[var(--color-brand-50)] to-white border border-[var(--color-brand-200)] p-4 flex items-start gap-3">
            <MessageCircle className="size-5 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
            <div className="text-xs text-zinc-700 leading-relaxed">
              <p className="font-bold text-[var(--color-brand-900)] mb-1">หลักการ</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>1 องค์กรเชื่อมได้หลาย LINE OA + หลาย FB Page</li>
                <li>แต่ละช่องทางเลือก &ldquo;ธุรกิจ&rdquo; ได้ (เก้าอี้นวด / ปั๊ม / ฯลฯ)</li>
                <li>แต่ละช่องทางมี webhook URL เฉพาะ · พาสต์ใน LINE Dev Console / FB App</li>
                <li>ข้อความที่เข้ามาจะมารวมกันใน /inbox · ตอบกลับได้จากที่เดียว</li>
              </ul>
            </div>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white border border-amber-200 p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-zinc-700 leading-relaxed">
              <p className="font-bold text-amber-900 mb-1">บอทตอบอัตโนมัติ</p>
              <p>
                เปิดบอทได้เฉพาะช่องทางที่เลือกธุรกิจ <b>เก้าอี้นวด</b> ·
                เมื่อเปิดแล้วบอทจะตอบลูกค้าด้วยคลังคำตอบที่ฝึกไว้ใน{" "}
                <code className="font-mono text-[10px] bg-amber-100 px-1.5 py-0.5 rounded">
                  /inbox/bot
                </code>{" "}
                ก่อน ถ้าตอบไม่ได้จะส่งต่อให้ทีมงาน
              </p>
            </div>
          </div>
        </div>

        <ChannelsManager initialChannels={channels} businesses={INBOX_BUSINESSES} />

        {/* PDPA / security note */}
        <div className="mt-6 rounded-2xl bg-zinc-50 border border-zinc-200 p-4 flex items-start gap-3">
          <ShieldCheck className="size-5 text-zinc-600 shrink-0 mt-0.5" />
          <div className="text-xs text-zinc-600 leading-relaxed">
            <p className="font-bold text-zinc-900 mb-1">ความปลอดภัย</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Webhook ของแต่ละช่องทางตรวจลายเซ็นด้วย secret เฉพาะตัว</li>
              <li>Access token เก็บแบบเข้ารหัส (AES-256-GCM)</li>
              <li>ข้อมูลถูกล็อกตามองค์กร · ช่องทางขององค์กรอื่นมองไม่เห็น</li>
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}
