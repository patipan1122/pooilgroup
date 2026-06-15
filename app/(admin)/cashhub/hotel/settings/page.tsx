// CASHHUB · โรงแรม — ตั้งค่าช่องทาง (ช่องไหน → ส่งเข้าบัญชีไหน) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import {
  loadHotelChannelConfigForSettings,
  computeHotelDeposits,
  hotelBranchHasOwnConfig,
} from "@/lib/cashhub/hotel-settlement-data";
import { listBankAccounts, listCompanies } from "@/lib/cashhub/amazon-settlement-data";
import { loadBranches } from "@/lib/cashhub/data";
import { HotelSettingsEditor } from "./hotel-settings-editor";
import { SendPreview, type SendPreviewDay } from "@/components/cashhub/send-preview";
import { SendPreviewControls } from "@/components/cashhub/send-preview-controls";
import { SettingsBranchPicker } from "@/components/cashhub/settings-branch-picker";

export const dynamic = "force-dynamic";

export default async function HotelSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; previewDate?: string }>;
}) {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  const admin = adminClient();
  const orgId = session.user.org_id;

  const sp = await searchParams;
  const branchCode = sp.branch ?? "";

  const [configs, accounts, companies, hasOwn] = await Promise.all([
    loadHotelChannelConfigForSettings(admin, orgId, branchCode),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
    hotelBranchHasOwnConfig(admin, orgId, branchCode),
  ]);

  // พรีวิว: รันสูตรเดียวกับตัวส่งจริง (computeHotelDeposits) — QR/เงินสด (ไม่หักค่าธรรมเนียม) · ใช้สาขาที่ตั้งค่า + ระบุวันที่
  const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.previewDate ?? "") ? sp.previewDate! : "";
  const accById = new Map(accounts.map((a) => [a.id, a.label]));
  const settleConfigs = configs.filter((c) => c.isSettle && c.active);
  const now = new Date();
  const dayTo = reqDate || now.toISOString().slice(0, 10);
  const dayFrom = reqDate || new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  // หาสาขาโรงแรม (ที่มีข้อมูลใน cashhub_hotel_daily ช่วง 90 วัน)
  const discFrom = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const allBranches = await loadBranches(orgId);
  const { data: hbRows } = await admin
    .from("cashhub_hotel_daily").select("branch_id").eq("org_id", orgId).gte("sales_date", discFrom);
  const hotelIds = new Set((hbRows ?? []).map((r) => String((r as { branch_id?: string }).branch_id)));
  const stores = allBranches.filter((b) => hotelIds.has(b.id)).map((b) => ({ code: b.id, label: b.name }));
  const activeStore = (branchCode && stores.some((s) => s.code === branchCode)) ? branchCode : (stores[0]?.code ?? "");
  const deposits = activeStore ? await computeHotelDeposits(admin, orgId, activeStore, dayFrom, dayTo) : [];
  const withMoney = deposits.filter((d) => d.qrBanked > 0 || d.cashDeposited > 0);
  const srcDeps = reqDate ? withMoney : withMoney.slice(-2);
  const previewDays: SendPreviewDay[] = srcDeps.map((d) => {
    const rows = settleConfigs
      .map((c) => ({ c, amt: c.channel === "qr" ? d.qrBanked : c.channel === "cash" ? d.cashDeposited : 0 }))
      .filter((x) => x.amt > 0)
      .map(({ c, amt }) => ({
        label: c.label, gross: amt, feePercent: 0, fee: 0, net: amt,
        account: c.bankAccountId ? (accById.get(c.bankAccountId) ?? "บัญชีถูกลบ") : "",
        hasAccount: !!c.bankAccountId && accById.has(c.bankAccountId),
      }));
    return { date: d.date, totalNet: rows.reduce((a, r) => a + r.net, 0), rows };
  });
  const storeLabel = stores.find((s) => s.code === activeStore)?.label ?? "";
  const previewCaption = `${storeLabel ? `สาขา ${storeLabel} · ` : ""}${reqDate ? `วันที่ ${reqDate}` : "2 วันล่าสุด"}`;

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
      <SettingsBranchPicker branches={stores} activeBranch={branchCode} hasOwnConfig={hasOwn} />
      <HotelSettingsEditor key={branchCode || "default"} configs={configs} accounts={accounts} companies={companies} branchCode={branchCode} />
      <div className="mt-8">
        <SendPreviewControls stores={[]} activeStore="" activeDate={reqDate} />
        <SendPreview days={previewDays} caption={previewCaption} showFee={false} />
      </div>
    </div>
  );
}
