// LedgerLine — /ledger/bank-recon/transfers
// โยกเงิน (ระหว่างบัญชี): pair an OUT leg in one account with an IN leg in
// another (equal amounts) → not counted as income/expense. + transfer history.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listAccountsForCompany, listSpecialItems } from "@/lib/ledger/recon-controls";
import { BankReconControlsNav } from "../_components/BankReconControlsNav";
import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TransfersClient } from "./TransfersClient";

export const dynamic = "force-dynamic";

export default async function BankReconTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!ledgerBankReconV1() || !scope.companyId) redirect("/ledger/bank-recon");
  const orgId = session.user.org_id;
  const companyId = scope.companyId;

  const [accounts, special] = await Promise.all([
    listAccountsForCompany({ orgId, companyId }),
    listSpecialItems({ orgId, companyId }),
  ]);
  const cp = `company=${companyId}`;

  return (
    <div className="px-4 py-3 sm:px-6 sm:py-4">
      <div className="mb-1">
        <Link
          href={`/ledger/bank-recon?${cp}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
        >
          <ChevronLeft size={14} /> กระทบยอดธนาคาร
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <ArrowLeftRight size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">โยกเงิน (ระหว่างบัญชี)</h1>
          <p className="text-xs text-zinc-400">จับคู่เงินออก–เงินเข้าข้ามบัญชี · ไม่นับเป็นรายรับ/รายจ่าย</p>
        </div>
      </div>

      <BankReconControlsNav companyId={companyId} active="transfers" />

      <TransfersClient accounts={accounts} transfers={special.transfers} companyId={companyId} />
    </div>
  );
}
