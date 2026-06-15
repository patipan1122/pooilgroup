// CASHHUB · โรงแรม — ตั้งค่าช่องทาง (ช่องไหน → ส่งเข้าบัญชีไหน) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { loadHotelChannelConfigForSettings } from "@/lib/cashhub/hotel-settlement-data";
import { listBankAccounts, listCompanies } from "@/lib/cashhub/amazon-settlement-data";
import { HotelSettingsEditor } from "./hotel-settings-editor";

export const dynamic = "force-dynamic";

export default async function HotelSettingsPage() {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const [configs, accounts, companies] = await Promise.all([
    loadHotelChannelConfigForSettings(admin, orgId),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
  ]);

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <BackButton label="โรงแรม" fallbackHref="/cashhub/hotel" />
      <header className="mt-3 mb-5">
        <SectionPill num="⚙️" label="โรงแรม · ตั้งค่าช่องทาง" />
        <TwoToneTitle first="ช่องทางไหน → " accent="เข้าบัญชีไหน" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          ตั้งว่าเงินแต่ละช่องทาง (เงินสด / QR / OTA) เข้าบัญชีธนาคารไหน → ตอนกด
          &ldquo;ส่งเข้ากระทบยอด&rdquo; ระบบจะส่งยอดไปบัญชีนั้นให้ถูกตัว
          (บัญชีใครบัญชีมัน — แมตช์ statement ได้ตรง)
        </p>
      </header>
      <HotelSettingsEditor configs={configs} accounts={accounts} companies={companies} />
    </div>
  );
}
