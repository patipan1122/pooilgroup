// LedgerLine — /ledger/bank-recon/[accountId]/reconcile
// PEAK-parity reconcile board BY DATE RANGE (continuous per account, not per file).
// รายการบันทึกบัญชี (book) ⟷ รายการเคลื่อนไหว (bank movements in the period).

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../../_scope";
import { LedgerHeader } from "../../../_components/LedgerHeader";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listBookEntries, listBankMovements, listMatchGroups } from "@/lib/ledger/bank-reconcile-board";
import { ReconcileBoard } from "../../_components/ReconcileBoard";
import { BankLogo } from "@/components/ledger/BankLogo";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { BANK_LABELS } from "@/lib/ledger/bank-adapters/types";

export const dynamic = "force-dynamic";

export default async function ReconcilePage({
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

  const acctRows = await prisma.$queryRaw<{ bankCode: string; accountNo: string; accountName: string }[]>`
    SELECT a.bank_code as "bankCode", a.account_no as "accountNo", a.account_name as "accountName"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.id = ${accountId}::uuid AND a.org_id = ${orgId}::uuid AND ac.company_id = ${companyId}::uuid
    LIMIT 1
  `;
  if (!acctRows.length) redirect("/ledger/bank-recon");
  const acct = acctRows[0];
  const maskedNo = acct.accountNo.length >= 4 ? `****${acct.accountNo.slice(-4)}` : acct.accountNo;

  const now = new Date();
  const period = sp.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("th-TH", { year: "numeric", month: "long" });

  const [bookEntries, bankMovements, suggestedGroups] = await Promise.all([
    listBookEntries({ orgId, companyId, periodStart, periodEnd }),
    listBankMovements({ orgId, companyId, bankAccountId: accountId, periodStart, periodEnd }),
    listMatchGroups({ orgId, companyId, bankAccountId: accountId, status: "suggested" }),
  ]);

  const prevM = new Date(year, month - 2, 1);
  const nextM = new Date(year, month, 1);
  const prevPeriod = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}`;
  const nextPeriod = nextM > now ? null : `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, "0")}`;
  const cp = `company=${companyId}`;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-2">
        <Link href={`/ledger/bank-recon/${accountId}?${cp}&period=${period}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600">
          <ChevronLeft size={14} /> {BANK_LABELS[acct.bankCode] ?? acct.bankCode} {maskedNo}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <BankLogo code={acct.bankCode} name={BANK_LABELS[acct.bankCode]} size={40} />
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">กระทบยอด — {acct.accountName}</h1>
          <p className="text-xs text-zinc-400">{BANK_LABELS[acct.bankCode] ?? acct.bankCode} · {maskedNo}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`?${cp}&period=${prevPeriod}`} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">←</Link>
          <span className="text-sm font-semibold text-zinc-800">{periodLabel}</span>
          {nextPeriod
            ? <Link href={`?${cp}&period=${nextPeriod}`} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">→</Link>
            : <span className="rounded-lg border border-zinc-100 px-3 py-1.5 text-sm text-zinc-300">→</span>}
        </div>
      </div>

      <ReconcileBoard
        bankAccountId={accountId}
        companyId={companyId}
        periodStart={periodStart}
        periodEnd={periodEnd}
        bookEntries={bookEntries}
        bankMovements={bankMovements}
        suggestedGroups={suggestedGroups}
      />
    </div>
  );
}
