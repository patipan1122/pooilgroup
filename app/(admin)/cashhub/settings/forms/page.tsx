// /cashhub/settings/forms — list of business-type forms (admin only)
//
// Shows all 12 business types with summary of their form (field count,
// cadence, reconcile flag). Click → per-type editor.

import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";
import {
  getEffectiveBusinessTypeConfig,
  readFormOverrides,
} from "@/lib/cashhub/form-config";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ClipboardEdit } from "lucide-react";

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

  // Branch count per business type
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

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-5xl mx-auto pb-24">
        <div className="mb-10 animate-slide-up-soft">
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
            CashHub · ตั้งค่า
          </p>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
            ฟอร์ม<span className="text-gradient-blue">กรอกยอด</span>
          </h1>
          <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-2xl leading-relaxed">
            กำหนดว่าพนักงานแต่ละธุรกิจจะ<strong className="font-bold text-zinc-900">เห็นอะไรในฟอร์ม</strong>
            <br className="hidden sm:block" />
            แก้ชื่อช่อง · ซ่อนช่องที่ไม่ใช้ · เปิด/ปิด required ได้ —
            <span className="text-zinc-500"> ช่องสำคัญถูกล็อกไว้ปลอดภัย</span>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
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
                className="group relative flex flex-col gap-3 rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover:shadow-blue transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="size-12 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center text-2xl shrink-0">
                    {bt.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-lg leading-tight font-display">
                      {bt.label}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {branchCount > 0
                        ? `${branchCount} สาขาใช้ฟอร์มนี้`
                        : "ยังไม่มีสาขา"}
                    </div>
                  </div>
                  <ArrowRight className="size-5 text-zinc-300 group-hover:text-[var(--color-brand-600)] group-hover:translate-x-0.5 transition-all" />
                </div>

                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <Badge tone="neutral">
                    {visibleFieldCount} ช่อง
                    {hiddenCount > 0 && (
                      <span className="text-zinc-500"> · ซ่อน {hiddenCount}</span>
                    )}
                  </Badge>
                  <Badge tone="neutral">
                    {CADENCE_LABEL[bt.reportingCadence] ?? bt.reportingCadence}
                  </Badge>
                  {bt.hasShifts && (
                    <Badge tone="neutral">
                      {bt.shifts.length} กะ
                    </Badge>
                  )}
                  {bt.hasReconcile && (
                    <Badge tone="brand">Reconcile</Badge>
                  )}
                  {overrideCount > 0 && (
                    <Badge tone="warning">
                      <ClipboardEdit className="size-3 inline mr-0.5" />
                      ปรับแล้ว {overrideCount}
                    </Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/60 p-5">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-zinc-100 flex items-center justify-center text-lg shrink-0">
              🛡️
            </div>
            <div className="text-sm text-zinc-700 leading-relaxed">
              <strong className="font-semibold text-zinc-900">ป้องกันโง่</strong> —
              ช่องที่จำเป็นต่อการคำนวณยอด (เช่น{" "}
              <code className="text-[12px] bg-white px-1.5 py-0.5 rounded border border-zinc-200">
                ยอดขายรวม
              </code>
              {", "}
              <code className="text-[12px] bg-white px-1.5 py-0.5 rounded border border-zinc-200">
                จำนวนลิตร/ถัง/แก้ว
              </code>
              ) ถูกล็อกไว้ ซ่อนหรือปิด required ไม่ได้
              เพื่อกันรายงานพังทั้งระบบ
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
