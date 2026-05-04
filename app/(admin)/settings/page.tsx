import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { OrgInfoForm } from "./org-form";
import { ModuleToggleList } from "./module-toggle";
import { CashHubConfigForm } from "./cashhub-config";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, slug, logo_url, settings, created_at")
    .eq("id", session.user.org_id)
    .single();

  const { data: modules } = await admin
    .from("org_modules")
    .select("module_name, is_active")
    .eq("org_id", session.user.org_id);

  const { count: userCount } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

  const { count: branchCount } = await admin
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

  const settings = (org?.settings as Record<string, unknown>) ?? {};

  // Default modules — if no rows yet, treat all as active
  const moduleStatus = {
    cashhub: true,
    fuelos: true,
    docuflow: true,
    ...(Object.fromEntries(
      (modules ?? []).map((m) => [m.module_name, m.is_active]),
    ) as Record<string, boolean>),
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
          องค์กร
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          ตั้งค่า <span className="accent">ระบบ</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          การกำหนดค่าทั่วไปขององค์กร · {userCount ?? 0} ผู้ใช้ · {branchCount ?? 0} สาขา
        </p>
      </div>

      <div className="space-y-4">
        <OrgInfoForm
          orgId={org?.id ?? ""}
          slug={org?.slug ?? ""}
          initial={{
            name: org?.name ?? "",
            logoUrl: org?.logo_url ?? "",
            timezone: String(settings.timezone ?? "Asia/Bangkok"),
            currency: String(settings.currency ?? "THB"),
          }}
        />

        <ModuleToggleList status={moduleStatus} />

        <CashHubConfigForm
          initial={{
            defaultDeadline: String(settings.defaultDeadline ?? "21:00"),
            reconcileMode: String(settings.reconcileMode ?? "binary") as
              | "binary"
              | "tolerance",
            reconcileTolerancePercent: Number(
              settings.reconcileTolerancePercent ?? 1,
            ),
            spikeMultiplier: Number(settings.spikeMultiplier ?? 1.5),
            offHoursStart: String(settings.offHoursStart ?? "00:00"),
            offHoursEnd: String(settings.offHoursEnd ?? "05:00"),
          }}
        />
      </div>
    </div>
  );
}
