// /admin/settings/backup — auto daily backup config + manual trigger + history
// Reads settings.backup JSONB · super_admin / org_admin only
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings · Backup

import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { Section } from "@/components/ui/section";
import { BackupForm, type BackupConfig, type BackupHistoryRow } from "./form";

export const dynamic = "force-dynamic";

const DEFAULT: BackupConfig = {
  autoDailyAt: "03:00",
  retentionDays: 30,
  destination: "cloudflare_r2",
};

export default async function BackupSettingsPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", session.user.org_id)
    .single();

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const stored = settings.backup as Partial<BackupConfig> | undefined;

  const initial: BackupConfig = {
    autoDailyAt: stored?.autoDailyAt ?? DEFAULT.autoDailyAt,
    retentionDays: stored?.retentionDays ?? DEFAULT.retentionDays,
    destination: stored?.destination ?? DEFAULT.destination,
  };

  // Backup history — read from audit_logs (BACKUP_TRIGGERED) until a real
  // backup_jobs table is added. Empty state is fine when no jobs yet.
  const { data: historyRows } = await admin
    .from("audit_logs")
    .select("id, created_at, user_id, diff")
    .eq("org_id", session.user.org_id)
    .eq("action", "BACKUP_TRIGGERED")
    .order("created_at", { ascending: false })
    .limit(20);

  const userIds = Array.from(
    new Set((historyRows ?? []).map((r) => r.user_id).filter(Boolean)),
  ) as string[];
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await admin
      .from("users")
      .select("id, name")
      .in("id", userIds);
    for (const u of users ?? []) userMap.set(u.id as string, u.name as string);
  }

  const history: BackupHistoryRow[] = (historyRows ?? []).map((row) => {
    const diff = row.diff as { new?: { kind?: string } } | null;
    return {
      id: row.id as string,
      createdAt: row.created_at as string,
      triggeredBy: row.user_id ? userMap.get(row.user_id as string) ?? "—" : "ระบบ",
      kind: diff?.new?.kind === "manual" ? "manual" : "auto",
    };
  });

  return (
    <div className="relative p-4 sm:p-8 lg:p-12 max-w-3xl mx-auto pb-24">
      <BackButton label="กลับไปตั้งค่าระบบ" fallbackHref="/settings" />

      <div className="mt-4 mb-10 animate-slide-up-soft">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-700)] font-bold">
          ตั้งค่าระบบ · Backup
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.02em] font-display mt-3 leading-tight">
          สำรองข้อมูล <span className="text-gradient-blue">รายวัน + Manual</span>
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 mt-3 max-w-xl leading-relaxed">
          ตั้งเวลา Backup อัตโนมัติทุกคืน · เก็บไฟล์ตามจำนวนวัน · กดสำรองเองได้เมื่อต้องการ
        </p>
      </div>

      <Section
        number="01"
        label="BACKUP"
        title="ค่าสำรองข้อมูล + ประวัติ"
        description="ค่าเริ่มต้น 03:00 น. เก็บ 30 วัน ปลายทาง Cloudflare R2"
      >
        <BackupForm initial={initial} history={history} />
      </Section>
    </div>
  );
}
