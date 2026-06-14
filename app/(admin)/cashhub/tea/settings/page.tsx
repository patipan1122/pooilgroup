// CASHHUB · ร้านชาไข่มุก — ตั้งค่าช่องทางชำระ → บัญชี/บริษัท (เตรียม reconcile) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { loadTeaChannelConfig } from "@/lib/cashhub/tea-data";
import { listBankAccounts, listCompanies } from "@/lib/cashhub/amazon-settlement-data";
import { TeaSettingsEditor } from "./tea-settings-editor";

export const dynamic = "force-dynamic";

export default async function TeaSettingsPage() {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const [configs, accounts, companies] = await Promise.all([
    loadTeaChannelConfig(admin, orgId),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
  ]);

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <BackButton label="ยอดขายร้านชา" fallbackHref="/cashhub/tea" />
      <header className="mt-3 mb-5">
        <SectionPill num="⚙️" label="ร้านชาไข่มุก · ตั้งค่าช่องทาง → บัญชี" />
        <TwoToneTitle first="เลือกบัญชีต่อช่องทาง " accent="(เตรียม Reconcile)" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          ตั้งว่าแต่ละช่องทาง (เงินสด/QR/Grab/Lineman/...) เงินเข้าบริษัท+บัญชีไหน · หักค่าธรรมเนียมกี่ % →
          เตรียมจับคู่กับเงินเข้าธนาคารจริงในขั้นกระทบยอด (reconcile)
        </p>
      </header>
      <TeaSettingsEditor configs={configs} accounts={accounts} companies={companies} canEdit />
    </div>
  );
}
