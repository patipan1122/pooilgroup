import Link from "next/link";
import { Fuel, MapPin, AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { fetchFlowcoDateRange } from "@/lib/cashhub/flowco-source";
import {
  resolveSteToBranch,
  FLOWCO_STATIONS,
} from "@/lib/cashhub/flowco-branch-map";
import { FlowcoImportView } from "./flowco-import-view";

export const dynamic = "force-dynamic";

export default async function FlowcoImportPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();

  const [range, steMap] = await Promise.all([
    fetchFlowcoDateRange(admin),
    resolveSteToBranch(admin, session.user.org_id),
  ]);

  const mapped = steMap.size;
  const total = FLOWCO_STATIONS.length;
  const allMapped = mapped >= total;

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-3xl mx-auto ch-scope">
      <BackButton label="ศูนย์นำเข้าข้อมูล" fallbackHref="/cashhub/import" />

      <header className="mb-5 animate-fade-up flex flex-col gap-2">
        <SectionPill num="⛽" label="FlowCo · ยอดขายปั๊มน้ำมัน" />
        <TwoToneTitle first="นำเข้ายอดขาย" accent="ปั๊มน้ำมัน" size={30} />
        <p className="text-[var(--ch-text-2)] mt-1 text-sm">
          ดึงยอดขายน้ำมันรายวันจากระบบ FlowCo (ในฐานข้อมูลเดียวกัน) แล้วบันทึกเป็นยอดรายวัน
          ต่อสาขา · ขึ้นหน้า ภาพรวม / รายงาน / Leaderboard ได้ปกติ
        </p>
      </header>

      {/* mapping status */}
      <Link
        href="/cashhub/import/flowco/branches"
        className={
          "flex items-center gap-3 rounded-2xl border-2 p-4 mb-4 transition-all animate-fade-up hover:shadow-sm " +
          (allMapped
            ? "border-[var(--ch-ok)] bg-[var(--ch-ok-bg,#ecfdf5)]"
            : "border-[#f59e0b] bg-[#fffbeb]")
        }
      >
        <div className="size-10 rounded-xl flex items-center justify-center shrink-0 bg-white border border-[var(--ch-border)]">
          {allMapped ? (
            <CheckCircle2 className="size-5 text-[var(--ch-ok)]" />
          ) : (
            <MapPin className="size-5 text-[#b45309]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-[var(--ch-text)]">
            จับคู่สาขาแล้ว {mapped}/{total} สาขา
          </p>
          <p className="text-xs text-[var(--ch-text-2)] mt-0.5">
            {allMapped
              ? "จับคู่ครบแล้ว — นำเข้าได้เต็มทุกสาขา · กดเพื่อแก้ไข"
              : "ยังจับคู่ไม่ครบ — สาขาที่ยังไม่จับคู่จะถูกข้าม · กดเพื่อจับคู่/สร้างสาขา"}
          </p>
        </div>
        <span className="text-xs font-semibold text-[var(--ch-brand)] shrink-0">
          จัดการ →
        </span>
      </Link>

      {mapped === 0 && (
        <div className="rounded-xl border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-sm text-[#92400e] flex items-start gap-2 mb-4">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          ยังไม่ได้จับคู่สาขาเลย — กรุณากด “จัดการ” ด้านบนเพื่อสร้าง/จับคู่สาขาปั๊มก่อนนำเข้า
        </div>
      )}

      <Link
        href="/cashhub/flowco"
        className="flex items-center gap-3 rounded-2xl border-2 border-[var(--ch-brand)] bg-[var(--ch-brand-50,#eef1ff)] p-4 mb-4 transition-all animate-fade-up hover:shadow-sm"
      >
        <div className="size-10 rounded-xl flex items-center justify-center shrink-0 bg-white border border-[var(--ch-border)]">
          <Fuel className="size-5 text-[var(--ch-brand)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-[var(--ch-text)]">
            ดูรายงานยอดขาย (กดดูรายสาขา · ตารางรายวัน · แยกวิธีจ่าย)
          </p>
          <p className="text-xs text-[var(--ch-text-2)] mt-0.5">
            อ่านสด ๆ จาก FlowCo — เลือกสาขา + ช่วงวัน ดูยอดขาย/เงินสด/บัตร/โอน ได้เลย
          </p>
        </div>
        <span className="text-xs font-semibold text-[var(--ch-brand)] shrink-0">
          เปิดรายงาน →
        </span>
      </Link>

      <FlowcoImportView
        defaultFrom={range.min}
        defaultTo={range.max}
        canImport={mapped > 0}
      />

      <p className="mt-5 text-[11px] text-[var(--ch-text-2)] text-center flex items-center justify-center gap-1">
        <Fuel className="size-3" />
        ยอดขาย = ผลรวมทุกชนิดน้ำมัน · แยกช่องเงินสด/บัตร/เชื่อ/โอน อัตโนมัติ · นำเข้าซ้ำได้ (เขียนทับ ไม่บวกซ้ำ)
      </p>
    </div>
  );
}
