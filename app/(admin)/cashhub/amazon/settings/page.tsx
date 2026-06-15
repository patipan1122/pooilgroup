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
import { AmazonPreviewControls } from "./amazon-preview-controls";

export const dynamic = "force-dynamic";

export default async function AmazonSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ previewStore?: string; previewDate?: string }>;
}) {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const [configs, accounts, companies] = await Promise.all([
    loadChannelConfig(admin, orgId),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
  ]);

  // พรีวิว: รันสูตรเดียวกับตัวส่งจริง (computeSendRows) — เลือกสาขา + ระบุวันที่ได้
  const sp = await searchParams;
  const reqStore = sp.previewStore ?? "";
  const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.previewDate ?? "") ? sp.previewDate! : "";
  const configByCvar = new Map(configs.map((c) => [c.cvar, c]));
  const accById = new Map(accounts.map((a) => [a.id, a.label]));
  const now = new Date();
  const dayTo = reqDate || now.toISOString().slice(0, 10);
  const dayFrom = reqDate || new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const stores = await listAmazonStores(admin, orgId);

  const buildDays = (raw: Awaited<ReturnType<typeof loadAmazonDays>>): SendPreviewDay[] =>
    raw.filter((d) => d.channels && Object.keys(d.channels).length > 0).map((d) => {
      const { rows, totalNet } = computeSendRows(d.channels, configByCvar);
      return {
        date: d.sales_date,
        totalNet,
        rows: rows.map((s) => {
          const accId = s.bankAccountId;
          return {
            label: s.label, gross: s.gross, feePercent: s.feePercent, fee: s.fee, net: s.net,
            account: accId ? (accById.get(accId) ?? "บัญชีถูกลบ") : "",
            hasAccount: !!accId && accById.has(accId),
          };
        }),
      };
    });

  let previewDays: SendPreviewDay[] = [];
  let activeStore = reqStore;
  let storeLabel = "";
  // ระบุสาขา → ใช้สาขานั้น · ไม่ระบุ → หาสาขาแรกที่มีข้อมูล
  const candidates = reqStore ? stores.filter((s) => s.store_code === reqStore) : stores.slice(0, 8);
  for (const st of candidates) {
    const days = buildDays(await loadAmazonDays(admin, orgId, st.store_code, dayFrom, dayTo));
    if (days.length === 0 && !reqStore) continue; // auto: ข้ามสาขาที่ว่าง
    activeStore = st.store_code;
    storeLabel = st.branch_label ?? st.store_code;
    previewDays = reqDate ? days : days.slice(-2);
    break;
  }
  const previewCaption = `${storeLabel ? `สาขา ${storeLabel} · ` : ""}${reqDate ? `วันที่ ${reqDate}` : "2 วันล่าสุด"}`;

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
      <div className="mt-8">
        <AmazonPreviewControls stores={stores} activeStore={activeStore} activeDate={reqDate} />
        <AmazonSendPreview days={previewDays} storeLabel={storeLabel} caption={previewCaption} />
      </div>
    </div>
  );
}
