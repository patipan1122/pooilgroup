// CASHHUB · Café Amazon — ตรวจยอดขาย + คีย์ IV อัตโนมัติจากไฟล์ POS ปิดกะ
// CEO 2026-06-14: อัปไฟล์ POS รายวัน → ระบบคำนวณ IV (VAT 7% + ช่องทาง) → รีวิว → กดสร้างเข้า TRCloud
//   เลิกนั่งคีย์ IV มือ. recipe พิสูจน์แล้ว (IV 1048468). human-confirm ก่อนสร้างเสมอ (ไม่ auto-post).
//   pilot = สาขาชุมชนหัวทะเล. ดู docs/WORKSHOP_cashhub-amazon-pos-iv.md
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { AmazonShell } from "./amazon-shell";

export const dynamic = "force-dynamic";

export default async function AmazonSalesPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role); // บัญชี/ผู้บริหารเท่านั้น

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-6xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-5">
        <SectionPill num="☕" label="Café Amazon · ตรวจยอด + คีย์ IV" />
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <TwoToneTitle first="ยอดขายร้านกาแฟ" accent="Café Amazon" size={30} />
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          อัปไฟล์ปิดกะ POS (.xlsx) → ระบบคำนวณใบกำกับภาษีรายวันให้ → ตรวจแล้วกดสร้างเข้า TRCloud
          (เลิกคีย์มือ) · ระบบกันสร้างใบซ้ำให้อัตโนมัติ
        </p>
      </header>

      <AmazonShell />
    </div>
  );
}
