// CASHHUB · Café Amazon — จัดการสาขา (super_admin เท่านั้น)
// CEO เพิ่มสาขาเองได้ ไม่ต้องเรียก dev: พิมพ์ชื่อสาขา → ระบบดึงค่าตั้งบัญชีจาก TRCloud อัตโนมัติ → ยืนยัน → เซฟ.
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { listAmazonBranchesForUi } from "@/lib/cashhub/amazon-branch-data";
import { BranchesEditor } from "./branches-editor";

export const dynamic = "force-dynamic";

export default async function AmazonBranchesPage() {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const branches = await listAmazonBranchesForUi(admin, orgId);

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-3xl mx-auto pb-24">
      <BackButton label="ตรวจยอด Amazon" fallbackHref="/cashhub/amazon" />
      <header className="mt-3 mb-5">
        <SectionPill num="🏪" label="Café Amazon · จัดการสาขา" />
        <TwoToneTitle first="สาขา" accent="Café Amazon" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          เพิ่มสาขาใหม่ได้เองโดยไม่ต้องเรียกทีมพัฒนา — พิมพ์ชื่อสาขา ระบบจะ
          <strong className="text-zinc-700"> ดึงค่าตั้งบัญชีจาก TRCloud ให้อัตโนมัติ</strong>{" "}
          แล้วกดยืนยัน (กันตั้งค่าผิด = ลงบัญชีผิดร้าน)
        </p>
      </header>

      <BranchesEditor branches={branches} />
    </div>
  );
}
