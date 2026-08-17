// LedgerLine — /ledger/bank-recon/special-items
// รายการพิเศษ (ทุกบัญชี): the workspace beside รอยืนยัน. Aggregates ACROSS ALL
// ACCOUNTS — (a) internal transfers + (b) skipped/no-match items (admin can pull
// a skipped item back with "เอากลับมา").

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listSpecialItems } from "@/lib/ledger/recon-controls";
import { BankReconControlsNav } from "../_components/BankReconControlsNav";
import { Sparkles, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SpecialItemsClient } from "./SpecialItemsClient";

export const dynamic = "force-dynamic";

export default async function BankReconSpecialItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; account?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!ledgerBankReconV1() || !scope.companyId) redirect("/ledger/bank-recon");
  const orgId = session.user.org_id;
  const companyId = scope.companyId;
  const account = sp.account;

  const { transfers, skipped } = await listSpecialItems({ orgId, companyId, bankAccountId: account });
  const cp = `company=${companyId}`;
  const backHref = account ? `/ledger/bank-recon/${account}?${cp}` : `/ledger/bank-recon?${cp}`;
  // unExcludeAction itself requires super_admin/org_admin/admin → match that gate in UI
  const canUnExclude = ["super_admin", "org_admin", "admin", "program_admin"].includes(session.user.role);

  return (
    <div className="px-4 py-3 sm:px-6 sm:py-4">
      <div className="mb-1">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
        >
          <ChevronLeft size={14} /> {account ? "กลับหน้าบัญชี" : "กระทบยอดธนาคาร"}
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Sparkles size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">รายการพิเศษ {account ? "(บัญชีนี้)" : "(ทุกบัญชี)"}</h1>
          <p className="text-xs text-zinc-400">โยกเงินภายใน + รายการที่ข้าม/ไม่มีคู่ {account ? "ของบัญชีนี้" : "จากทุกบัญชีรวมกัน"}</p>
        </div>
      </div>

      <BankReconControlsNav companyId={companyId} active="special-items" account={account} />

      <SpecialItemsClient transfers={transfers} skipped={skipped} canUnExclude={canUnExclude} />
    </div>
  );
}
