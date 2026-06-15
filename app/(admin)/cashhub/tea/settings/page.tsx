// CASHHUB · ร้านชาไข่มุก — ตั้งค่าช่องทางชำระ → บัญชี/บริษัท (เตรียม reconcile) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { loadTeaChannelConfig, loadTeaDays } from "@/lib/cashhub/tea-data";
import { computeTeaSettlement } from "@/lib/cashhub/tea-channels";
import { listBankAccounts, listCompanies } from "@/lib/cashhub/amazon-settlement-data";
import { TeaSettingsEditor } from "./tea-settings-editor";
import { SendPreview, type SendPreviewDay } from "@/components/cashhub/send-preview";
import { SendPreviewControls } from "@/components/cashhub/send-preview-controls";

export const dynamic = "force-dynamic";

export default async function TeaSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ previewStore?: string; previewDate?: string }>;
}) {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const [configs, accounts, companies] = await Promise.all([
    loadTeaChannelConfig(admin, orgId),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
  ]);

  // พรีวิว: รันสูตรเดียวกับตัวส่งจริง (computeTeaSettlement) — เลือกสาขา + ระบุวันที่
  const sp = await searchParams;
  const reqStore = sp.previewStore ?? "";
  const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.previewDate ?? "") ? sp.previewDate! : "";
  const configByCode = new Map(configs.map((c) => [c.code, c]));
  const accById = new Map(accounts.map((a) => [a.id, a.label]));
  const now = new Date();
  const dayTo = reqDate || now.toISOString().slice(0, 10);
  const dayFrom = reqDate || new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const allDays = await loadTeaDays(admin, orgId, dayFrom, dayTo);
  const stores = [...new Map(allDays.map((d) => [d.branch_code, d.branch_label])).entries()]
    .map(([code, label]) => ({ code, label: label || code }));
  const hasData = (code: string) => allDays.some((d) => d.branch_code === code && d.pos_channels && Object.keys(d.pos_channels).length > 0);
  const activeStore = (reqStore && stores.some((s) => s.code === reqStore)) ? reqStore : (stores.find((s) => hasData(s.code))?.code ?? stores[0]?.code ?? "");
  const branchDays = allDays.filter((d) => d.branch_code === activeStore && d.pos_channels && Object.keys(d.pos_channels).length > 0);
  const src = reqDate ? branchDays : branchDays.slice(-2);
  const previewDays: SendPreviewDay[] = src.map((d) => {
    const { perChannel, totalNet } = computeTeaSettlement(d.pos_channels as Record<string, number> | null, configByCode);
    return {
      date: d.sales_date,
      totalNet,
      rows: perChannel.filter((s) => s.settled).map((s) => ({
        label: s.label, gross: s.gross, feePercent: configByCode.get(s.code)?.feePercent ?? 0, fee: s.fee, net: s.net,
        account: s.bankAccountId ? (accById.get(s.bankAccountId) ?? "บัญชีถูกลบ") : "",
        hasAccount: !!s.bankAccountId && accById.has(s.bankAccountId),
      })),
    };
  });
  const storeLabel = stores.find((s) => s.code === activeStore)?.label ?? activeStore;
  const previewCaption = `${storeLabel ? `สาขา ${storeLabel} · ` : ""}${reqDate ? `วันที่ ${reqDate}` : "2 วันล่าสุด"}`;

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
      <div className="mt-8">
        <SendPreviewControls stores={stores} activeStore={activeStore} activeDate={reqDate} />
        <SendPreview days={previewDays} caption={previewCaption} showFee />
      </div>
    </div>
  );
}
