// LedgerLine — /ledger/bank-recon/accounts: บัญชีธนาคาร management
// Add / edit / deactivate bank accounts (rows in ledger_bank_account + company junction).
// Future-proof: admins manage accounts here instead of editing the DB directly.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { prisma } from "@/lib/prisma";
import { AccountsManager } from "./_components/AccountsManager";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BankAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="บัญชีธนาคาร" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  if (!ledgerBankReconV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="บัญชีธนาคาร" scope={scope} />
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
          ระบบกระทบยอดธนาคารยังไม่เปิดใช้
        </div>
      </div>
    );
  }

  const companyId = scope.companyId;
  const canEdit = ["super_admin", "org_admin", "admin"].includes(session.user.role);

  const accounts = await prisma.$queryRaw<{
    id: string;
    bankCode: string;
    accountNo: string;
    accountName: string;
    accountType: string;
    legalEntity: string | null;
    flowType: string | null;
    isActive: boolean;
  }[]>`
    SELECT
      a.id,
      a.bank_code     as "bankCode",
      a.account_no    as "accountNo",
      a.account_name  as "accountName",
      a.account_type  as "accountType",
      a.legal_entity  as "legalEntity",
      a.flow_type     as "flowType",
      a.is_active     as "isActive"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.org_id = ${session.user.org_id}::uuid
      AND ac.company_id = ${companyId}::uuid
      AND ac.can_view = true
    ORDER BY a.is_active DESC, a.bank_code, a.account_no
  `;

  const activeCount = accounts.filter((a) => a.isActive).length;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-2">
        <Link
          href={`/ledger/bank-recon?company=${companyId}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
        >
          <ChevronLeft size={14} />
          กลับหน้ากระทบยอด
        </Link>
      </div>

      <LedgerHeader
        title="บัญชีธนาคาร"
        subtitle={`${activeCount} บัญชีใช้งาน · ${accounts.length - activeCount} ปิดใช้งาน`}
        scope={scope}
      />

      <AccountsManager
        companyId={companyId}
        canEdit={canEdit}
        accounts={accounts}
      />
    </div>
  );
}
