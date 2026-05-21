import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
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
        <div className="mb-10 animate-slide-up-soft flex flex-col gap-2">
          <SectionPill num="00" label="CashHub · ตั้งค่า" />
          <TwoToneTitle first="ตั้งค่า" accent="CashHub" size={40} />
          <p className="text-base text-[var(--ch-text-2)] mt-2 max-w-xl leading-relaxed">
            ค่าเริ่มต้นที่ใช้กับ{" "}
            <strong className="font-bold text-[var(--ch-navy)] ch-tnum">
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
