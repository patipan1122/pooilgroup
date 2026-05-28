import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { OrgInfoForm } from "./org-form";
import { ModuleToggleList } from "./module-toggle";

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

  // Default modules — if no rows yet, treat all as active.
  // Spread DB rows on top so admin-controlled toggles override defaults.
  const moduleStatus = {
    cashhub: true,
    docuflow: true,
    fuelos: true,
    ...(Object.fromEntries(
      (modules ?? []).map((m) => [m.module_name, m.is_active]),
    ) as Record<string, boolean>),
  };

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-3xl mx-auto pb-24">
      <div className="mb-12 animate-slide-up-soft">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-700)] font-bold">
          องค์กร
        </p>
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
          ตั้งค่า <span className="text-gradient-blue">ระบบ</span>
        </h1>
        <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-xl leading-relaxed">
          การกำหนดค่าทั่วไปขององค์กร ·{" "}
          <strong className="font-bold text-zinc-900 tabular-num">{userCount ?? 0}</strong>{" "}
          ผู้ใช้ ·{" "}
          <strong className="font-bold text-zinc-900 tabular-num">{branchCount ?? 0}</strong>{" "}
          สาขา
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
      </div>
      </div>
    </div>
  );
}
