// /cashhub/settings/forms — list of business-type forms (admin only).
// Re-skinned per Claude Design handoff MLMc2DZd7q-5cmIzvrh5hw — FormBuilderV1 hero.
//
// Shows all business types with summary of their form (field count,
// cadence, reconcile flag). Click → per-type 3-pane editor.

import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";
import {
  getEffectiveBusinessTypeConfig,
  readFormOverrides,
} from "@/lib/cashhub/form-config";
import { ArrowRight, ClipboardEdit, Info } from "lucide-react";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  daily: "รายวัน",
  weekly: "รายสัปดาห์",
  biweekly: "ทุก 2 สัปดาห์",
  monthly: "รายเดือน",
  none: "—",
};

export default async function FormsListPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", session.user.org_id)
    .single();

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const overridesMap = readFormOverrides(settings);

  const { data: branches } = await admin
    .from("branches")
    .select("business_type")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

  const branchCountByType = new Map<string, number>();
  for (const b of (branches ?? [])) {
    branchCountByType.set(
      b.business_type,
      (branchCountByType.get(b.business_type) ?? 0) + 1,
    );
  }

  const totalBranches = branches?.length ?? 0;
  const totalTypes = BUSINESS_TYPE_LIST.length;
  const overriddenTypes = BUSINESS_TYPE_LIST.filter(
    (bt) => overridesMap[bt.type] && Object.keys(overridesMap[bt.type]!).length > 0,
  ).length;

  return (
    <div className="min-h-full bg-[var(--ch-bg-2)]">
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-6xl mx-auto">
        {/* Hero — matches FormBuilderV1 design */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
          <div>
            <SectionPill num="📋" label="Form Builder" />
            <div className="mt-2">
              <TwoToneTitle first="ฟอร์ม" accent="กรอกยอด" size={36} />
            </div>
            <p className="text-sm text-[var(--ch-text-2)] mt-2 max-w-2xl leading-relaxed">
              เลือกประเภทธุรกิจที่ต้องการตั้งค่า · 1 ประเภท = 1 ฟอร์มหลัก ·
              แก้ชื่อช่อง · ซ่อนช่องที่ไม่ใช้ · เปิด/ปิด required
              <span className="text-[var(--ch-text-3)]">
                {" "}— ช่องสำคัญถูกล็อกไว้ปลอดภัย
              </span>
            </p>
          </div>
          <div className="flex-1" />
          <div className="ch-card-v2 bg-white p-3 flex gap-5 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--ch-text-3)]">
                ประเภทธุรกิจ
              </div>
              <div className="ch-tnum text-xl font-bold text-[var(--ch-navy)] mt-0.5">
                {totalTypes}
              </div>
            </div>
            <div className="w-px bg-[var(--ch-border)]" />
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--ch-text-3)]">
                ปรับแล้ว
              </div>
              <div className="ch-tnum text-xl font-bold text-[var(--ch-brand)] mt-0.5">
                {overriddenTypes}
              </div>
            </div>
            <div className="w-px bg-[var(--ch-border)]" />
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--ch-text-3)]">
                สาขาทั้งหมด
              </div>
              <div className="ch-tnum text-xl font-bold text-[var(--ch-navy)] mt-0.5">
                {totalBranches}
              </div>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {BUSINESS_TYPE_LIST.map((bt) => {
            const branchCount = branchCountByType.get(bt.type) ?? 0;
            const overrides = overridesMap[bt.type];
            const overrideCount = overrides
              ? Object.keys(overrides).length
              : 0;
            const effective = getEffectiveBusinessTypeConfig(
              bt.type,
              settings,
            );
            const visibleFieldCount = effective?.fields.length ?? 0;
            const totalFieldCount = bt.fields.length;
            const hiddenCount = totalFieldCount - visibleFieldCount;

            return (
              <Link
                key={bt.type}
                href={`/cashhub/settings/forms/${bt.type}`}
                className="ch-card-v2 group relative flex flex-col gap-3 bg-white p-4 hover:border-[var(--ch-brand)] hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="size-11 rounded-xl bg-[var(--ch-brand-50)] border border-[var(--ch-brand-100)] flex items-center justify-center text-xl shrink-0">
                    {bt.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-base leading-tight text-[var(--ch-navy)]">
                      {bt.label}
                    </div>
                    <div className="text-[11px] text-[var(--ch-text-3)] mt-0.5">
                      {branchCount > 0
                        ? `${branchCount} สาขาใช้ฟอร์มนี้`
                        : "ยังไม่มีสาขา"}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-[var(--ch-text-3)] group-hover:text-[var(--ch-brand)] group-hover:translate-x-0.5 transition-all" />
                </div>

                <div className="flex flex-wrap gap-1.5 text-[10.5px]">
                  <span className="px-2 py-0.5 rounded-full bg-[var(--ch-bg-3)] text-[var(--ch-text-2)] font-semibold">
                    {visibleFieldCount} ช่อง
                    {hiddenCount > 0 && (
                      <span className="text-[var(--ch-text-3)] font-normal">
                        {" "}· ซ่อน {hiddenCount}
                      </span>
                    )}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--ch-bg-3)] text-[var(--ch-text-2)] font-semibold">
                    {CADENCE_LABEL[bt.reportingCadence] ?? bt.reportingCadence}
                  </span>
                  {bt.hasShifts && (
                    <span className="px-2 py-0.5 rounded-full bg-[var(--ch-bg-3)] text-[var(--ch-text-2)] font-semibold">
                      {bt.shifts.length} กะ
                    </span>
                  )}
                  {bt.hasReconcile && (
                    <span className="px-2 py-0.5 rounded-full bg-[var(--ch-brand-50)] text-[var(--ch-brand)] font-semibold">
                      Reconcile
                    </span>
                  )}
                  {overrideCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-[var(--ch-pending-soft)] text-[#a16207] font-semibold inline-flex items-center gap-1">
                      <ClipboardEdit className="size-2.5" />
                      ปรับแล้ว {overrideCount}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Safety hint */}
        <div className="mt-6 ch-card-v2 border-dashed bg-white p-4 flex items-start gap-3">
          <div className="size-8 rounded-lg bg-[var(--ch-bg-3)] grid place-items-center shrink-0">
            <Info className="size-4 text-[var(--ch-text-2)]" />
          </div>
          <div className="text-sm text-[var(--ch-text-2)] leading-relaxed">
            <strong className="font-semibold text-[var(--ch-navy)]">
              ป้องกันโง่
            </strong>{" "}
            — ช่องที่จำเป็นต่อการคำนวณยอด (เช่น{" "}
            <code className="text-[12px] bg-[var(--ch-bg-3)] px-1.5 py-0.5 rounded">
              ยอดขายรวม
            </code>
            {", "}
            <code className="text-[12px] bg-[var(--ch-bg-3)] px-1.5 py-0.5 rounded">
              จำนวนลิตร/ถัง/แก้ว
            </code>
            ) ถูกล็อกไว้ ซ่อนหรือปิด required ไม่ได้
          </div>
        </div>
      </div>
    </div>
  );
}
