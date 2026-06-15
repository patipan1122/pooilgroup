import { notFound } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import { PUMP_KEY } from "@/lib/cashhub/fuel-import-core";
import { FuelManageView, type FuelRow } from "./fuel-manage-view";

export const dynamic = "force-dynamic";

export default async function FuelManagePage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  if (!cashhubFuelV1()) notFound();

  const admin = adminClient();
  const { data } = await admin
    .from("cashhub_fuel_daily")
    .select(
      "report_date, shift, liters, total_sales, fuel_sales, engine_oil_sales, cash_submitted, cash_banked, cash_diff_sheet, cash_diff_calc, credit, transfer_total, card_total, grand_total_both, staff_name, note, recon_status, anomaly_codes, bank_breakdown, sheet_tab, source_fetched_at",
    )
    .eq("org_id", session.user.org_id)
    .eq("pump_key", PUMP_KEY)
    .order("report_date", { ascending: false })
    .order("shift", { ascending: true });

  const rows = (data ?? []) as unknown as FuelRow[];

  if (rows.length === 0) {
    return (
      <div className="ch-scope p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
        <header className="mb-6 mt-2 flex flex-col gap-2">
          <SectionPill num="07" label="Fuel · ปั๊มน้ำมัน 62" />
          <TwoToneTitle first="ปั๊ม 62" accent="หัวทะเล" size={32} />
        </header>
        <div className="rounded-2xl border border-[var(--ch-border)] bg-[var(--ch-bg-2)] p-8 text-center">
          <p className="text-[var(--ch-text-2)]">ยังไม่มีข้อมูล — เริ่มจากนำเข้ายอดก่อน</p>
          <Link
            href="/cashhub/import/fuel-pump62"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 text-sm font-semibold"
          >
            <Upload className="size-4" /> นำเข้ายอดปั๊ม
          </Link>
        </div>
      </div>
    );
  }

  const fetchedAt =
    rows.map((r) => r.source_fetched_at).filter(Boolean).sort().reverse()[0] ??
    null;

  return (
    <div className="ch-scope p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <SectionPill num="07" label="Fuel · ปั๊มน้ำมัน 62" />
          <TwoToneTitle first="ปั๊ม 62" accent="หัวทะเล" size={32} />
          <p className="text-[var(--ch-text-2)] text-sm">
            บริษัทวายเอ็มพลัส · ตรวจยอดขาย + กระทบเงินเข้าบัญชี รายกะ
          </p>
        </div>
        <Link
          href="/cashhub/import/fuel-pump62"
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ch-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ch-text)] hover:border-[var(--ch-brand)]"
        >
          <Upload className="size-3.5" /> นำเข้า/อัปเดตยอด
        </Link>
      </header>

      <FuelManageView rows={rows} fetchedAt={fetchedAt} />
    </div>
  );
}
