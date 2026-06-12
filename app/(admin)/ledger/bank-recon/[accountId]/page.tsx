// LedgerLine — /ledger/bank-recon/[accountId]
// PEAK-parity account overview ("ภาพรวมเงินเข้า-เงินออก"):
//   summary (ยอดยกมา/เข้า/ออก/คงเหลือ) + 2 tabs (รายการบันทึก / รายการเคลื่อนไหว)
//   + import statement + "ไปหน้ากระทบยอด".

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listBatchesAction } from "../_actions";
import {
  accountSummary, listBankLedger, listBookLedger,
} from "@/lib/ledger/bank-reconcile-board";
import { ImportWizardWrapper } from "./_components/ImportWizardWrapper";
import { AccountLedgerTabs } from "./_components/AccountLedgerTabs";
import { BankLogo } from "../_components/BankLogo";
import { prisma } from "@/lib/prisma";
import { Upload, Scale } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BANK_LABELS as BANK_NAMES } from "@/lib/ledger/bank-adapters/types";

export const dynamic = "force-dynamic";

function baht(s: number) {
  return (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function BankAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ company?: string; branch?: string; period?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const { accountId } = await params;
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);
  if (!ledgerBankReconV1() || !scope.companyId) redirect("/ledger/bank-recon");
  const orgId = session.user.org_id;
  const companyId = scope.companyId;

  const accountRows = await prisma.$queryRaw<{
    id: string; bankCode: string; accountNo: string; accountName: string; canImport: boolean;
  }[]>`
    SELECT a.id, a.bank_code as "bankCode", a.account_no as "accountNo",
           a.account_name as "accountName", ac.can_import as "canImport"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.id = ${accountId}::uuid AND a.org_id = ${orgId}::uuid
      AND ac.company_id = ${companyId}::uuid AND a.is_active = true
    LIMIT 1
  `;
  if (!accountRows.length) redirect("/ledger/bank-recon");
  const account = accountRows[0];
  const maskedNo = account.accountNo.length >= 4 ? `****${account.accountNo.slice(-4)}` : account.accountNo;
  const bankLabel = `${BANK_NAMES[account.bankCode] ?? account.bankCode} ${maskedNo}`;

  const now = new Date();
  const period = sp.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("th-TH", { year: "numeric", month: "long" });

  const [summary, bankLedger, bookLedger, batches] = await Promise.all([
    accountSummary({ orgId, companyId, bankAccountId: accountId, periodStart, periodEnd }),
    listBankLedger({ orgId, companyId, bankAccountId: accountId, periodStart, periodEnd }),
    listBookLedger({ orgId, companyId, periodStart, periodEnd }),
    listBatchesAction(accountId),
  ]);

  const prevM = new Date(year, month - 2, 1);
  const nextM = new Date(year, month, 1);
  const prevPeriod = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}`;
  const nextPeriod = nextM > now ? null : `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, "0")}`;
  const cp = `company=${companyId}`;

  const unreconciled = bankLedger.filter((r) => r.matchState === "unmatched" || r.matchState === "suggested").length;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-2">
        <Link href={`/ledger/bank-recon?${cp}&period=${period}`} className="text-xs text-zinc-400 hover:text-zinc-600">
          ← กลับหน้ากระทบยอดธนาคาร
        </Link>
      </div>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <BankLogo bankCode={account.bankCode} size={44} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-zinc-900">{account.accountName}</h1>
          <p className="text-xs text-zinc-400">
            {BANK_NAMES[account.bankCode] ?? account.bankCode} · {maskedNo}
            {summary.lastImportedDate && <span className="ml-2 text-zinc-400">· อัพ statement ถึง {summary.lastImportedDate}</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`?${cp}&period=${prevPeriod}`} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">←</Link>
          <span className="text-sm font-semibold text-zinc-800">{periodLabel}</span>
          {nextPeriod
            ? <Link href={`?${cp}&period=${nextPeriod}`} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">→</Link>
            : <span className="rounded-lg border border-zinc-100 px-3 py-1.5 text-sm text-zinc-300">→</span>}
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "ยอดยกมา", value: summary.openingSatang, color: "text-zinc-700" },
          { label: "รวมเงินเข้า", value: summary.inSatang, color: "text-emerald-600", sign: "+" },
          { label: "รวมเงินออก", value: summary.outSatang, color: "text-rose-600", sign: "−" },
          { label: "คงเหลือ", value: summary.closingSatang, color: "text-blue-700" },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-zinc-100 bg-white p-3">
            <p className="text-xs text-zinc-400">{c.label}</p>
            <p className={`mt-1 text-lg font-bold ${c.color}`}>{c.sign ?? ""}฿{baht(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/ledger/bank-recon/${accountId}/reconcile?${cp}&period=${period}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Scale size={16} /> ไปหน้ากระทบยอด
          {unreconciled > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs">{unreconciled}</span>}
        </Link>
        {account.canImport && (
          <span className="text-xs text-zinc-400">นำเข้า statement ด้านล่าง แล้วกระทบยอดตามช่วงเวลา</span>
        )}
      </div>

      {/* 2-tab ledger */}
      <AccountLedgerTabs bankLedger={bankLedger} bookLedger={bookLedger} companyId={companyId} />

      {/* Import + history */}
      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-zinc-100 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">นำเข้า bank statement</h2>
            {account.canImport ? (
              <ImportWizardWrapper bankAccountId={accountId} accountName={bankLabel} />
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                บัญชีนี้ไม่ได้รับอนุญาตให้ import
              </div>
            )}
          </div>
        </div>
        <div className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">ประวัติการนำเข้า</h2>
          {batches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-12 text-center">
              <Upload size={28} className="mx-auto mb-2 text-zinc-300" />
              <p className="text-sm text-zinc-500">ยังไม่มีการนำเข้า statement</p>
            </div>
          ) : (
            <div className="space-y-2">
              {batches.map((batch) => (
                <div key={batch.id} className="flex items-center justify-between rounded-xl border border-zinc-100 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-800">{batch.periodStart} → {batch.periodEnd}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">{batch.insertedCount} รายการ</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
