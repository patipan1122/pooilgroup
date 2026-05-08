// /admin/settings/security — session timeout, lockout, password policy
// Reads settings.security JSONB · super_admin / org_admin only
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings + RULES.md Rule 21

import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { Section } from "@/components/ui/section";
import { SecurityForm, type SecurityConfig } from "./form";

export const dynamic = "force-dynamic";

const DEFAULT: SecurityConfig = {
  sessionIdleMinutes: 60,
  accessTokenHours: 8,
  lockAfterFailedAttempts: 5,
  lockDurationMinutes: 15,
  password: {
    minLength: 8,
    requireSymbol: false,
    requireNumber: true,
    requireUpper: false,
    forceChangeOnFirstLogin: true,
  },
};

export default async function SecuritySettingsPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", session.user.org_id)
    .single();

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const stored = settings.security as Partial<SecurityConfig> | undefined;

  const initial: SecurityConfig = {
    sessionIdleMinutes: stored?.sessionIdleMinutes ?? DEFAULT.sessionIdleMinutes,
    accessTokenHours: stored?.accessTokenHours ?? DEFAULT.accessTokenHours,
    lockAfterFailedAttempts:
      stored?.lockAfterFailedAttempts ?? DEFAULT.lockAfterFailedAttempts,
    lockDurationMinutes:
      stored?.lockDurationMinutes ?? DEFAULT.lockDurationMinutes,
    password: {
      minLength: stored?.password?.minLength ?? DEFAULT.password.minLength,
      requireSymbol:
        stored?.password?.requireSymbol ?? DEFAULT.password.requireSymbol,
      requireNumber:
        stored?.password?.requireNumber ?? DEFAULT.password.requireNumber,
      requireUpper:
        stored?.password?.requireUpper ?? DEFAULT.password.requireUpper,
      forceChangeOnFirstLogin:
        stored?.password?.forceChangeOnFirstLogin ??
        DEFAULT.password.forceChangeOnFirstLogin,
    },
  };

  return (
    <div className="relative p-4 sm:p-8 lg:p-12 max-w-3xl mx-auto pb-24">
      <BackButton label="กลับไปตั้งค่าระบบ" fallbackHref="/settings" />

      <div className="mt-4 mb-10 animate-slide-up-soft">
        <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
          ตั้งค่าระบบ · ความปลอดภัย
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.02em] font-display mt-3 leading-tight">
          ความปลอดภัย <span className="text-gradient-blue">+ Password Policy</span>
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 mt-3 max-w-xl leading-relaxed">
          กำหนดอายุ Session · จำนวนครั้ง Login ผิด · ความซับซ้อนของ Password
        </p>
      </div>

      <Section
        number="01"
        label="SECURITY"
        title="Session + Password Policy"
        description="มีผลกับผู้ใช้ใหม่ทุกคน · ผู้ใช้เก่าจะถูกบังคับเปลี่ยนเมื่อ Login ครั้งถัดไป"
      >
        <SecurityForm initial={initial} />
      </Section>
    </div>
  );
}
