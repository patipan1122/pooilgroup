// CASHHUB · ร้านชาไข่มุก — ตั้งค่าช่องทางชำระ → บัญชี/บริษัท (เตรียม reconcile) · super_admin เท่านั้น
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import {
  loadTeaChannelConfig,
  loadTeaDays,
  listTeaBranches,
  teaBranchHasOwnConfig,
} from "@/lib/cashhub/tea-data";
import { computeTeaSettlement } from "@/lib/cashhub/tea-channels";
import { listBankAccounts, listCompanies } from "@/lib/cashhub/amazon-settlement-data";
import { TeaSettingsEditor } from "./tea-settings-editor";
import { SendPreview, type SendPreviewDay } from "@/components/cashhub/send-preview";
import { SendPreviewControls } from "@/components/cashhub/send-preview-controls";
import { SettingsBranchPicker } from "@/components/cashhub/settings-branch-picker";

export const dynamic = "force-dynamic";

export default async function TeaSettingsPage({
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

  const [configs, accounts, companies, branches, hasOwn] = await Promise.all([
    loadTeaChannelConfig(admin, orgId, branchCode),
    listBankAccounts(admin, orgId),
    listCompanies(admin, orgId),
    listTeaBranches(admin, orgId),
    teaBranchHasOwnConfig(admin, orgId, branchCode),
  ]);

  // พรีวิว: รันสูตรเดียวกับตัวส่งจริง (computeTeaSettlement) — ใช้สาขาที่กำลังตั้งค่า + ระบุวันที่
  const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.previewDate ?? "") ? sp.previewDate! : "";
  const configByCode = new Map(configs.map((c) => [c.code, c]));
  const accById = new Map(accounts.map((a) => [a.id, a.label]));
  const now = new Date();
  const dayTo = reqDate || now.toISOString().slice(0, 10);
  const dayFrom = reqDate || new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const allDays = await loadTeaDays(admin, orgId, dayFrom, dayTo);
  const hasData = (code: string) => allDays.some((d) => d.branch_code === code && d.pos_channels && Object.keys(d.pos_channels).length > 0);
  // สาขาที่ตั้งค่า มีข้อมูล → พรีวิวสาขานั้น · ถ้าเป็น "ค่าเริ่มต้น" (หรือสาขานั้นไม่มีข้อมูล) → สุ่มสาขาแรกที่มีข้อมูล เป็นตัวอย่าง
  const previewStore = branchCode && hasData(branchCode) ? branchCode : (branches.find((b) => hasData(b.code))?.code ?? "");
  const branchDays = allDays.filter((d) => d.branch_code === previewStore && d.pos_channels && Object.keys(d.pos_channels).length > 0);
  const src = reqDate ? branchDays : branchDays.slice(-2);
  const previewDays: SendPreviewDay[] = src.map((d) => {
    const { perChannel, totalNet } = computeTeaSettlement(d.pos_channels as Record<string, number> | null, configByCode);
    return {
      date: d.sales_date,
      totalNet,
      rows: perChannel.map((s) => ({
        label: s.label, gross: s.gross, feePercent: configByCode.get(s.code)?.feePercent ?? 0, fee: s.fee, net: s.net,
        account: s.bankAccountId ? (accById.get(s.bankAccountId) ?? "บัญชีถูกลบ") : "",
        hasAccount: !!s.bankAccountId && accById.has(s.bankAccountId),
        willSend: s.settled,
        skipReason: s.pending ? "ต่ำกว่าขั้นต่ำ/วัน — รอสะสม" : (!s.settled ? "ไม่ส่ง (ส่วนลด/แต้ม)" : ""),
      })),
    };
  });
  const previewLabel = branches.find((b) => b.code === previewStore)?.label ?? previewStore;
  const sampleNote = branchCode && previewStore && previewStore !== branchCode ? " (ตัวอย่างจากสาขาที่มีข้อมูล)" : "";
  const previewCaption = `${previewLabel ? `สาขา ${previewLabel} · ` : ""}${reqDate ? `วันที่ ${reqDate}` : "2 วันล่าสุด"}${sampleNote}`;

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <BackButton label="ยอดขายร้านชา" fallbackHref="/cashhub/tea" />
      <header className="mt-3 mb-5">
        <SectionPill num="⚙️" label="ร้านชาไข่มุก · ตั้งค่าช่องทาง → บัญชี" />
        <TwoToneTitle first="เลือกบัญชีต่อช่องทาง " accent="(เตรียม Reconcile)" size={28} />
        <p className="text-sm text-zinc-500 mt-1">
          ตั้งว่าแต่ละช่องทาง (เงินสด/QR/Grab/Lineman/...) เงินเข้าบริษัท+บัญชีไหน · หักค่าธรรมเนียมกี่ % →
          เตรียมจับคู่กับเงินเข้าธนาคารจริงในขั้นกระทบยอด (reconcile) · ตั้งแยกแต่ละสาขาได้
        </p>
      </header>
      <SettingsBranchPicker branches={branches} activeBranch={branchCode} hasOwnConfig={hasOwn} />
      <TeaSettingsEditor key={branchCode || "default"} configs={configs} accounts={accounts} companies={companies} canEdit branchCode={branchCode} />
      <div className="mt-8">
        <SendPreviewControls stores={[]} activeStore="" activeDate={reqDate} />
        <SendPreview days={previewDays} caption={previewCaption} showFee />
      </div>
    </div>
  );
}
