// CASHHUB · ⛽ ปั๊มน้ำมัน — ตั้งค่าช่องทาง (ช่องไหน → ส่งเข้าบัญชีไหน) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { loadFuelChannelConfig } from "@/lib/cashhub/fuel-settlement-data";
import { listBankAccounts, listCompanies } from "@/lib/cashhub/amazon-settlement-data";
import { FuelSettingsEditor } from "./fuel-settings-editor";

export const dynamic = "force-dynamic";

export default async function FuelSettingsPage() {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const [configs, accounts, companies] = await Promise.all([
    loadFuelChannelConfig(admin, orgId),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
  ]);

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <BackButton label="ปั๊มน้ำมัน 62" fallbackHref="/cashhub/fuel-pump62" />
      <header className="mt-3 mb-5">
        <SectionPill num="⚙️" label="ปั๊มน้ำมัน · ตั้งค่าช่องทาง → บัญชี" />
        <TwoToneTitle first="ช่องทางไหน → " accent="เข้าบัญชีไหน" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          ตั้งว่าเงินเข้าจริงแต่ละช่อง (เงินสดนำฝาก / QR+บัตร K+ / บัตรเครดิต / คุณแอ้ม)
          เข้าบัญชีธนาคารไหน + บริษัทไหน → เตรียมส่งเข้าหน้ากระทบยอดให้ถูกบัญชี
          (ปกติทุกช่อง = TTB …3134)
        </p>
      </header>
      <FuelSettingsEditor configs={configs} accounts={accounts} companies={companies} />
    </div>
  );
}
