// LedgerLine — /ledger/bank-recon/[accountId]/[batchId]
// Match page: 2-panel reconcile view (PEAK Account parity).
// Fetches all three tab sets in parallel, renders MatchPanel + optional lock banner.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../../_scope";
import { LedgerHeader } from "../../../_components/LedgerHeader";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listBankTxnsForBatch } from "@/lib/ledger/bank-statement-reconcile";
import { listRevenueEntriesForPeriod } from "@/lib/ledger/trcloud-revenue";
import { MatchPanel } from "../../_components/MatchPanel";
import { PeriodLockBanner } from "../../_components/PeriodLockBanner";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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

  if (!ledgerBankReconV1()) {
    redirect("/ledger/bank-recon");
  }

  const companyId = scope.companyId ?? "";

  // Load batch info + all tab data + revenue entries in parallel
  const [batchRows, unmatched, suggested, confirmed] = await Promise.all([
    prisma.$queryRaw<{
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
        AND b.org_id = ${session.user.org_id}::uuid
      LIMIT 1
    `,
    listBankTxnsForBatch({ batchId, orgId: session.user.org_id, companyId, tab: "unmatched" }),
    listBankTxnsForBatch({ batchId, orgId: session.user.org_id, companyId, tab: "suggested" }),
    listBankTxnsForBatch({ batchId, orgId: session.user.org_id, companyId, tab: "confirmed" }),
  ]);

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
  const companyParam = scope.companyId ? `company=${scope.companyId}` : "";

  // Load revenue entries for this period (book side for credit matching)
  const revenueEntries = await listRevenueEntriesForPeriod({
    orgId: session.user.org_id,
    companyId,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
  });

  // Map DB rows to MatchPanel type
  type BankTxnRow = {
    id: string;
    txnDate: string;
    amountSatang: number;
    description: string | null;
    channel: string | null;
    ref1: string | null;
    matchState: string;
    matchId: string | null;
    matchConfidence: string | null;
    matchType: string | null;
    deltaSatang: number | null;
  };
  const toRow = (r: (typeof unmatched)[number]): BankTxnRow => ({
    id: r.id,
    txnDate: r.txnDate,
    amountSatang: Number(r.amountSatang),
    description: r.description,
    channel: r.channel,
    ref1: r.ref1,
    matchState: r.matchState,
    matchId: r.matchId,
    matchConfidence: r.matchConfidence,
    matchType: r.matchType,
    deltaSatang: r.deltaSatang !== null ? Number(r.deltaSatang) : null,
  });

  return (
    <div className="p-4 sm:p-6">
      {/* Back navigation */}
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
        subtitle={`${batch.periodStart} → ${batch.periodEnd} · ${batch.insertedCount} รายการ`}
        scope={scope}
      />

      {isLocked && batch.lockedAt && batch.fingerprint && (
        <PeriodLockBanner
          lockedAt={batch.lockedAt}
          fingerprint={batch.fingerprint}
          lockedBy={batch.lockedByName ?? undefined}
        />
      )}

      <MatchPanel
        batchId={batchId}
        unmatched={unmatched.map(toRow)}
        suggested={suggested.map(toRow)}
        confirmed={confirmed.map(toRow)}
        revenueEntries={revenueEntries.map((r) => ({
          id: r.id,
          entryDate: r.entryDate,
          amountSatang: Number(r.amountSatang),
          sourceType: r.sourceType,
          sourceRef: r.sourceRef,
          description: r.description,
          customerName: r.customerName,
          paymentChannel: r.paymentChannel,
          matchState: r.matchState,
        }))}
        isLocked={isLocked}
        canLock={canLock}
      />
    </div>
  );
}
