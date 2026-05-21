// /admin/settings/notifications — Telegram + Email notification config
// Reads settings.notifications JSONB · super_admin / org_admin only
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings + §5 Notifications

import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { Section } from "@/components/ui/section";
import { NotificationsForm, type NotificationsConfig } from "./form";

export const dynamic = "force-dynamic";

const DEFAULT_CONFIG: NotificationsConfig = {
  morningBriefAt: "07:00",
  eveningCheckAt: "18:00",
  audience: "with_org_admin",
  channels: { telegram: true, email: false },
  telegramChatIds: [],
  emailRecipients: [],
};

export default async function NotificationsSettingsPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", session.user.org_id)
    .single();

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const stored = settings.notifications as Partial<NotificationsConfig> | undefined;

  const initial: NotificationsConfig = {
    morningBriefAt: stored?.morningBriefAt ?? DEFAULT_CONFIG.morningBriefAt,
    eveningCheckAt: stored?.eveningCheckAt ?? DEFAULT_CONFIG.eveningCheckAt,
    audience: stored?.audience ?? DEFAULT_CONFIG.audience,
    channels: {
      telegram: stored?.channels?.telegram ?? true,
      email: stored?.channels?.email ?? false,
    },
    telegramChatIds: stored?.telegramChatIds ?? [],
    emailRecipients: stored?.emailRecipients ?? [],
  };

  return (
    <div className="relative p-4 sm:p-8 lg:p-12 max-w-3xl mx-auto pb-24">
      <BackButton label="กลับไปตั้งค่าระบบ" fallbackHref="/settings" />

      <div className="mt-4 mb-10 animate-slide-up-soft">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-700)] font-bold">
          ตั้งค่าระบบ · การแจ้งเตือน
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.02em] font-display mt-3 leading-tight">
          แจ้งเตือน <span className="text-gradient-blue">Morning Brief & Evening Check</span>
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 mt-3 max-w-xl leading-relaxed">
          กำหนดเวลา Telegram สรุปประจำวัน · เลือกผู้รับ · เปิด/ปิดช่องทาง
        </p>
      </div>

      <Section
        number="01"
        label="การแจ้งเตือน"
        title="ตั้งค่าการแจ้งเตือน"
        description="ค่าที่ตั้งใช้กับ Cron จริง — Morning Brief 07:00, Evening Check 18:00 ตามค่าเริ่มต้น"
      >
        <NotificationsForm initial={initial} />
      </Section>
    </div>
  );
}
