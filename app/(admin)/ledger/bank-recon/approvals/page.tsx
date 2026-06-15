// LedgerLine — /ledger/bank-recon/approvals
// คำขออนุมัติแก้: super_admin approves/rejects revert requests; admins view
// status of their own requests. PENDING first, then recent decided.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listEditRequests } from "@/lib/ledger/recon-controls";
import { BankReconControlsNav } from "../_components/BankReconControlsNav";
import { ClipboardCheck, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ApprovalsClient } from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function BankReconApprovalsPage({
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

  // all statuses (PENDING + recent decided) — split client-side
  const requests = await listEditRequests({ orgId, companyId });
  const cp = `company=${companyId}`;
  const isSuper = session.user.role === "super_admin";

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
          <ClipboardCheck size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">คำขออนุมัติแก้</h1>
          <p className="text-xs text-zinc-400">
            {isSuper ? "อนุมัติ/ปฏิเสธคำขอย้อนรายการที่ยืนยันแล้ว" : "ดูสถานะคำขอแก้ของทีม"}
          </p>
        </div>
      </div>

      <BankReconControlsNav companyId={companyId} active="approvals" />

      <ApprovalsClient requests={requests} isSuper={isSuper} />
    </div>
  );
}
