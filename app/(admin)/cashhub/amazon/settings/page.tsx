// CASHHUB · Café Amazon — ตั้งค่าช่องทางชำระ (ค่าธรรมเนียม + บัญชีที่เงินเข้า) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import {
  loadChannelConfig,
  listBankAccounts,
  listCompanies,
} from "@/lib/cashhub/amazon-settlement-data";
import { AmazonSettingsEditor } from "./amazon-settings-editor";

export const dynamic = "force-dynamic";

export default async function AmazonSettingsPage() {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const [configs, accounts, companies] = await Promise.all([
    loadChannelConfig(admin, orgId),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
  ]);

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <BackButton label="ตรวจยอด Amazon" fallbackHref="/cashhub/amazon" />
      <header className="mt-3 mb-5">
        <SectionPill num="⚙️" label="Café Amazon · ตั้งค่าช่องทาง" />
        <TwoToneTitle first="ค่าธรรมเนียม + " accent="บัญชีที่เงินเข้า" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          ตั้งว่าแต่ละช่องทางหักค่าธรรมเนียมกี่ % · ยอดขั้นต่ำที่โอน · เงินเข้าบัญชีไหน →
          ระบบคำนวณ &ldquo;เงินเข้าจริง&rdquo; + ส่งเข้าหน้ากระทบยอดธนาคารให้
        </p>
      </header>
      <AmazonSettingsEditor configs={configs} accounts={accounts} companies={companies} />
    </div>
  );
}
