// LedgerLine — /ledger/bank-recon/[accountId]
// Bank account detail: import history + wizard to import a new batch.
// Shows all batches for this account (newest first) with status + link to Match page.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader } from "../../_components/LedgerHeader";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listBatchesAction } from "../_actions";
import { ImportWizardWrapper } from "./_components/ImportWizardWrapper";
import { prisma } from "@/lib/prisma";
import { CheckCircle, Clock, Lock, Upload, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const BANK_NAMES: Record<string, string> = {
  KBANK: "กสิกรไทย",
  SCB:   "ไทยพาณิชย์",
  TTB:   "TTB",
  BBL:   "กรุงเทพ",
  BAAC:  "ธ.ก.ส.",
  KTB:   "กรุงไทย",
  BAY:   "กรุงศรีฯ",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "locked") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
        <Lock size={10} /> ล็อคแล้ว
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle size={10} /> เสร็จแล้ว
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <Clock size={10} /> กำลังทำ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-500">
      <AlertTriangle size={10} /> ยังไม่เริ่ม
    </span>
  );
}

export default async function BankAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ company?: string; branch?: string; period?: string }>;
}) {
  const session = await requireRole(
    "super_admin", "org_admin", "admin", "area_manager", "viewer",
  );
  const { accountId } = await params;
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!ledgerBankReconV1() || !scope.companyId) {
    redirect("/ledger/bank-recon");
  }

  const companyId = scope.companyId;

  // Load account info
  const accountRows = await prisma.$queryRaw<{
    id: string;
    bankCode: string;
    accountNo: string;
    accountName: string;
    canImport: boolean;
  }[]>`
    SELECT
      a.id,
      a.bank_code as "bankCode",
      a.account_no as "accountNo",
      a.account_name as "accountName",
      ac.can_import as "canImport"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.id = ${accountId}::uuid
      AND a.org_id = ${session.user.org_id}::uuid
      AND ac.company_id = ${companyId}::uuid
      AND a.is_active = true
    LIMIT 1
  `;

  if (!accountRows.length) {
    redirect("/ledger/bank-recon");
  }

  const account = accountRows[0];
  const maskedNo = account.accountNo.length >= 4
    ? `****${account.accountNo.slice(-4)}`
    : account.accountNo;
  const bankLabel = `${BANK_NAMES[account.bankCode] ?? account.bankCode} ${maskedNo}`;

  const batches = await listBatchesAction(accountId);
  const companyParam = `&company=${companyId}`;

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title={`${BANK_NAMES[account.bankCode] ?? account.bankCode} — ${maskedNo}`}
        subtitle={account.accountName}
        scope={scope}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Left: import wizard */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-zinc-100 bg-white p-4">
            {account.canImport ? (
              <ImportWizardWrapper
                bankAccountId={accountId}
                accountName={bankLabel}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                บัญชีนี้ไม่ได้รับอนุญาตให้ import
              </div>
            )}
          </div>
        </div>

        {/* Right: batch history */}
        <div className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">ประวัติการนำเข้า</h2>
          {batches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-12 text-center">
              <Upload size={28} className="mx-auto mb-2 text-zinc-300" />
              <p className="text-sm text-zinc-500">ยังไม่มีการนำเข้า statement</p>
            </div>
          ) : (
            <div className="space-y-2">
              {batches.map((batch) => {
                const isLocked = batch.status === "locked";
                return (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-100 bg-white px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-800">
                          {batch.periodStart} → {batch.periodEnd}
                        </p>
                        <StatusBadge status={batch.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {batch.insertedCount} รายการ
                        {isLocked && batch.fingerprint && (
                          <span className="ml-2 font-mono text-purple-500">
                            {batch.fingerprint.slice(0, 12)}...
                          </span>
                        )}
                      </p>
                    </div>
                    <Link
                      href={`/ledger/bank-recon/${accountId}/${batch.id}?${companyParam}`}
                      className="ml-3 shrink-0 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      กระทบยอด
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
