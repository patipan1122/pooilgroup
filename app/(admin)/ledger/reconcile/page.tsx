// LedgerLine PR4 — /ledger/reconcile: the accountant's "ขอโอนเงิน → จ่าย → สลิป →
// กระทบยอด" worklist. Read-only EXCEPT pairing a floating slip to an open request
// (the existing assignSlipToRequestAction). Flag-gated by LEDGER_PAYREQ_V1.
//
// Multi-tenant: every query is scoped by orgId AND companyId (resolved from the
// shared LedgerHeader picker) — never org-only. Pooil ↔ JP Sync are separate
// legal entities; an org-wide read would leak requests/slips across them.
import { requireRole } from "@/lib/auth/session";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { ledgerPayreqV1 } from "@/lib/ledger/flags";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listReconcile, listReconcileVendors } from "@/lib/ledger/payment-request-queries";
import { ReconcileBoard } from "./_components/ReconcileBoard";
import { ReconcileFilterBar } from "./_components/ReconcileFilterBar";
import { ReconcileExportButton } from "./_components/ReconcileExportButton";

export const dynamic = "force-dynamic";

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    branch?: string;
    month?: string;
    vendor?: string;
  }>;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
  );
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="กระทบยอดจ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  if (!ledgerPayreqV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="กระทบยอดจ่าย" scope={scope} />
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
          ระบบกระทบยอดจ่ายยังไม่เปิดใช้ — เปิดได้ที่ Vercel (LEDGER_PAYREQ_V1)
        </div>
      </div>
    );
  }

  const month = typeof sp.month === "string" ? sp.month : "";
  // ?vendor= รองรับหลายชื่อ คั่นด้วย comma (multi-select tick filter).
  const vendorParam = typeof sp.vendor === "string" ? sp.vendor : "";
  const vendors = vendorParam
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const [data, canMatch, vendorOptions] = await Promise.all([
    listReconcile(scope.orgId, scope.companyId, {
      branchId: scope.branchId,
      month: month || null,
      vendors: vendors.length ? vendors : null,
    }),
    ledgerWebCanForRole(scope.orgId, session.user.role, "expense.confirm"),
    listReconcileVendors(scope.orgId, scope.companyId, scope.branchId),
  ]);

  const totalCount =
    data.summary.awaiting.count +
    data.summary.partial.count +
    data.summary.paid.count +
    data.summary.abnormal.count;

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="กระทบยอดจ่าย"
        subtitle={`${totalCount} รายการ — รอโอน ${data.summary.awaiting.count} · ต้องตรวจ ${data.summary.abnormal.count}`}
        scope={scope}
        right={
          <ReconcileExportButton
            companyId={scope.companyId}
            branchId={scope.branchId ?? ""}
            month={month}
            vendors={vendors}
          />
        }
      />

      <ReconcileFilterBar
        branches={scope.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        branchId={scope.branchId ?? ""}
        month={month}
        vendorOptions={vendorOptions}
        selectedVendors={vendors}
      />

      <ReconcileBoard
        awaiting={data.awaiting}
        partial={data.partial}
        paid={data.paid}
        abnormal={data.abnormal}
        floatingSlips={data.floatingSlips}
        summary={data.summary}
        canMatch={canMatch}
      />
    </div>
  );
}
