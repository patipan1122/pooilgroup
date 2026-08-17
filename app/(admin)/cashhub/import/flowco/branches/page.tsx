import { requireRole } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { FlowcoBranchMapView } from "./branch-map-view";

export const dynamic = "force-dynamic";

export default async function FlowcoBranchMapPage() {
  await requireRole("super_admin", "org_admin", "admin", "program_admin");

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-3xl mx-auto ch-scope">
      <BackButton label="นำเข้า FlowCo" fallbackHref="/cashhub/import/flowco" />
      <header className="mb-5 animate-fade-up flex flex-col gap-2">
        <SectionPill num="⛽" label="FlowCo · จับคู่สาขา" />
        <TwoToneTitle first="จับคู่" accent="สาขาปั๊ม" size={30} />
        <p className="text-[var(--ch-text-2)] mt-1 text-sm">
          จับคู่รหัสสาขาจาก FlowCo (1003, 1004, …) กับสาขาใน CashHub ·
          สาขาที่ยังไม่มีระบบจะสร้างให้อัตโนมัติ · ทำครั้งเดียว ใช้ตลอด
        </p>
      </header>
      <FlowcoBranchMapView />
    </div>
  );
}
