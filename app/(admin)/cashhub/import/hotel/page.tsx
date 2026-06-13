// CASHHUB · Import → Hotel — นำเข้ายอดขายโรงแรมจากชีต Excel
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { HotelImportShell } from "./hotel-import-shell";

export const dynamic = "force-dynamic";

export default async function HotelImportPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const admin = adminClient();
  const { data } = await admin
    .from("branches")
    .select("id, name")
    .eq("org_id", session.user.org_id)
    .eq("business_type", "hotel")
    .eq("is_active", true)
    .order("name");
  const branches = (data ?? []) as Array<{ id: string; name: string }>;

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-3xl mx-auto pb-24">
      <BackButton label="ตรวจยอดขายโรงแรม" fallbackHref="/cashhub/hotel" />
      <header className="mt-3 mb-5">
        <SectionPill num="⬆" label="Import · นำเข้ายอดขายโรงแรม" />
        <TwoToneTitle first="นำเข้าจาก" accent="ชีต Excel" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          ส่งไฟล์ <b>.xlsx</b> (ดาวน์โหลดจาก Google Sheet → File → Download → Microsoft
          Excel) ระบบจะอ่านยอดราย วัน/กะ แล้วให้ตรวจตัวอย่างก่อนบันทึก
        </p>
      </header>
      <HotelImportShell branches={branches} />
    </div>
  );
}
