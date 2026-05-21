import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { CashHubConfigForm } from "./cashhub-config";

export const dynamic = "force-dynamic";

export default async function CashHubSettingsPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", session.user.org_id)
    .single();

  const settings = (org?.settings as Record<string, unknown>) ?? {};

  const { count: branchCount } = await admin
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

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
            CashHub
          </p>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
            ตั้งค่า <span className="text-gradient-blue">CashHub</span>
          </h1>
          <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-xl leading-relaxed">
            ค่าเริ่มต้นที่ใช้กับ{" "}
            <strong className="font-bold text-zinc-900 tabular-num">
              {branchCount ?? 0}
            </strong>{" "}
            สาขา · แต่ละสาขา override ได้ที่หน้าสาขาตัวเอง
          </p>
        </div>

        <div className="space-y-4">
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
    </div>
  );
}
