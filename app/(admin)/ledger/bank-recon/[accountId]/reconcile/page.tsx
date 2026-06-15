// LedgerLine — /ledger/bank-recon/[accountId]/reconcile
// PEAK-parity reconcile board BY DATE RANGE (continuous per account, not per file).
// รายการบันทึกบัญชี (book) ⟷ รายการเคลื่อนไหว (bank movements in the period).

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listBookEntries, listBankMovements, listMatchGroups } from "@/lib/ledger/bank-reconcile-board";
import { ReconcileBoard } from "../../_components/ReconcileBoard";
import { ReconcileMonthRange } from "./_components/ReconcileMonthRange";
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
  searchParams: Promise<{ company?: string; branch?: string; period?: string; periodTo?: string }>;
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
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  // ช่วงเดือน: ดูได้หลายเดือนพร้อมกัน (เดือนเริ่ม → เดือนจบ) — query bounded ตามช่วง (เร็ว)
  let periodFrom = sp.period ?? curMonth;
  let periodTo = sp.periodTo ?? periodFrom;
  if (periodFrom > periodTo) [periodFrom, periodTo] = [periodTo, periodFrom]; // กันสลับ
  const [fy, fm] = periodFrom.split("-").map(Number);
  const [ty, tm] = periodTo.split("-").map(Number);
  const periodStart = `${fy}-${String(fm).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10);
  // ตัวเลือกเดือน 18 เดือนล่าสุด
  const monthOptions: string[] = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const [bookEntries, bankMovements, suggestedGroups] = await Promise.all([
    listBookEntries({ orgId, companyId, bankAccountId: accountId, periodStart, periodEnd }),
    listBankMovements({ orgId, companyId, bankAccountId: accountId, periodStart, periodEnd }),
    listMatchGroups({ orgId, companyId, bankAccountId: accountId, status: "suggested" }),
  ]);

  const cp = `company=${companyId}`;

  return (
    <div className="px-4 py-3 sm:px-6 sm:py-4">
      <div className="mb-1">
        <Link href={`/ledger/bank-recon/${accountId}?${cp}&period=${periodFrom}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600">
          <ChevronLeft size={14} /> {BANK_LABELS[acct.bankCode] ?? acct.bankCode} {maskedNo}
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <BankLogo code={acct.bankCode} name={BANK_LABELS[acct.bankCode]} size={32} />
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">กระทบยอด — {acct.accountName}</h1>
          <p className="text-xs text-zinc-400">{BANK_LABELS[acct.bankCode] ?? acct.bankCode} · {maskedNo}</p>
        </div>
        <div className="ml-auto">
          <ReconcileMonthRange from={periodFrom} to={periodTo} options={monthOptions} />
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
