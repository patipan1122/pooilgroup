// LedgerLine — /ledger/bank-recon/[accountId]/[batchId]
// PEAK-parity reconcile board: รายการบันทึกบัญชี (book) ⟷ รายการเคลื่อนไหว (bank).
// 2-step: รอกระทบยอด (select + match) → รอยืนยัน (confirm all) → lock.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../../_scope";
import { LedgerHeader } from "../../../_components/LedgerHeader";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import {
  listBookEntries, listBankMovements, listMatchGroups,
} from "@/lib/ledger/bank-reconcile-board";
import { ReconcileBoard } from "../../_components/ReconcileBoard";
import { PeriodLockBanner } from "../../_components/PeriodLockBanner";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { BANK_LABELS as BANK_NAMES } from "@/lib/ledger/bank-adapters/types";

export const dynamic = "force-dynamic";

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string; batchId: string }>;
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole(
    "super_admin", "org_admin", "admin", "area_manager", "viewer",
  );
  const { accountId, batchId } = await params;
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!ledgerBankReconV1() || !scope.companyId) {
    redirect("/ledger/bank-recon");
  }
  const orgId = session.user.org_id;
  const companyId = scope.companyId;

  const batchRows = await prisma.$queryRaw<{
    id: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    insertedCount: number;
    lockedAt: string | null;
    lockedByName: string | null;
    fingerprint: string | null;
    bankCode: string;
    accountNo: string;
    accountName: string;
  }[]>`
    SELECT
      b.id,
      b.period_start::text as "periodStart",
      b.period_end::text as "periodEnd",
      b.status,
      b.inserted_count as "insertedCount",
      b.locked_at::text as "lockedAt",
      b.lock_fingerprint as "fingerprint",
      u.raw_user_meta_data->>'full_name' as "lockedByName",
      a.bank_code as "bankCode",
      a.account_no as "accountNo",
      a.account_name as "accountName"
    FROM ledger_bank_import_batch b
    JOIN ledger_bank_account a ON a.id = b.bank_account_id
    LEFT JOIN auth.users u ON u.id = b.locked_by
    WHERE b.id = ${batchId}::uuid
      AND b.bank_account_id = ${accountId}::uuid
      AND b.org_id = ${orgId}::uuid
    LIMIT 1
  `;
  if (!batchRows.length) {
    redirect(`/ledger/bank-recon/${accountId}`);
  }
  const batch = batchRows[0];
  const isLocked = batch.status === "locked";
  const canLock =
    ["super_admin", "org_admin", "admin"].includes(session.user.role) && !isLocked;

  const maskedNo = batch.accountNo.length >= 4
    ? `****${batch.accountNo.slice(-4)}`
    : batch.accountNo;
  const bankLabel = `${BANK_NAMES[batch.bankCode] ?? batch.bankCode} ${maskedNo}`;
  const companyParam = `company=${companyId}`;

  // Load both sides of the board + suggested groups + a confirmed counter
  const [bookEntries, bankMovements, suggestedGroups, confirmedRows] = await Promise.all([
    listBookEntries({ orgId, companyId, periodStart: batch.periodStart, periodEnd: batch.periodEnd }),
    listBankMovements({ orgId, companyId, batchId }),
    listMatchGroups({ orgId, companyId, bankAccountId: accountId, status: "suggested" }),
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(*)::int as c FROM ledger_bank_txn
      WHERE batch_id = ${batchId}::uuid AND org_id = ${orgId}::uuid
        AND match_state IN ('confirmed','excluded')`,
  ]);
  const confirmedCount = confirmedRows[0]?.c ?? 0;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-2">
        <Link
          href={`/ledger/bank-recon/${accountId}?${companyParam}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
        >
          <ChevronLeft size={14} />
          {bankLabel}
        </Link>
      </div>

      <LedgerHeader
        title={`กระทบยอด — ${bankLabel}`}
        subtitle={`${batch.periodStart} → ${batch.periodEnd} · ${batch.insertedCount} รายการ · กระทบแล้ว ${confirmedCount}`}
        scope={scope}
      />

      {isLocked && batch.lockedAt && batch.fingerprint && (
        <PeriodLockBanner
          lockedAt={batch.lockedAt}
          fingerprint={batch.fingerprint}
          lockedBy={batch.lockedByName ?? undefined}
        />
      )}

      <ReconcileBoard
        batchId={batchId}
        bankAccountId={accountId}
        companyId={companyId}
        bookEntries={bookEntries}
        bankMovements={bankMovements}
        suggestedGroups={suggestedGroups}
        confirmedCount={confirmedCount}
        isLocked={isLocked}
        canLock={canLock}
      />
    </div>
  );
}
