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
import { computeSendRows } from "@/lib/cashhub/amazon-settlement";
import { loadAmazonDays, listAmazonStores } from "@/lib/cashhub/amazon-data";
import { AmazonSettingsEditor } from "./amazon-settings-editor";
import { AmazonRuleSummary } from "./amazon-rule-summary";
import { AmazonSendPreview, type SendPreviewDay } from "./amazon-send-preview";

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

  // พรีวิว: ข้อมูลจริง 2 วันล่าสุด (รันสูตรเดียวกับตัวส่งจริง) — หาสาขาแรกที่มีข้อมูล
  const configByCvar = new Map(configs.map((c) => [c.cvar, c]));
  const accById = new Map(accounts.map((a) => [a.id, a.label]));
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const stores = await listAmazonStores(admin, orgId);
  let previewDays: SendPreviewDay[] = [];
  let storeLabel = "";
  for (const st of stores.slice(0, 8)) {
    const rawDays = await loadAmazonDays(admin, orgId, st.store_code, from, to);
    const withData = rawDays.filter((d) => d.channels && Object.keys(d.channels).length > 0);
    if (withData.length === 0) continue;
    storeLabel = st.branch_label ?? st.store_code;
    previewDays = withData.slice(-2).map((d) => {
      // รวมช่องที่โอนก้อนเดียว (QR+QR Manual+wallet) แล้ว — สูตรเดียวกับตัวส่งจริง
      const { rows, totalNet } = computeSendRows(d.channels, configByCvar);
      return {
        date: d.sales_date,
        totalNet,
        rows: rows.map((s) => {
          const accId = s.bankAccountId;
          return {
            label: s.label,
            gross: s.gross,
            feePercent: s.feePercent,
            fee: s.fee,
            net: s.net,
            account: accId ? (accById.get(accId) ?? "บัญชีถูกลบ") : "",
            hasAccount: !!accId && accById.has(accId),
          };
        }),
      };
    });
    break;
  }

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
      <AmazonRuleSummary configs={configs} />
      <AmazonSettingsEditor configs={configs} accounts={accounts} companies={companies} />
      <AmazonSendPreview days={previewDays} storeLabel={storeLabel} />
    </div>
  );
}
