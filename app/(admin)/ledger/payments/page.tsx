// LedgerLine PR4 (D4) — "สลิปลอย": payment slips the auto-matcher couldn't pair
// to exactly one unpaid bill. The accountant pairs them here (the dedup already
// ran at intake, so nothing on this page can double-pay). Flag-gated.
import { requireRole } from "@/lib/auth/session";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listExpensesSummary } from "../_data";
import { listFloatingPayments } from "@/lib/ledger/payments";
import { ledgerSlipV1 } from "@/lib/ledger/flags";
import { FloatingSlipList } from "./_components/FloatingSlipList";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
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
        <LedgerHeader title="สลิปจ่ายเงิน" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  if (!ledgerSlipV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="สลิปจ่ายเงิน" scope={scope} />
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
          ระบบรับสลิปอัตโนมัติยังไม่เปิดใช้ — เปิดได้ที่ Vercel (LEDGER_SLIP_V1) แล้วตั้งกลุ่มส่งสลิปในหน้า “ตั้งค่า”
        </div>
      </div>
    );
  }

  const canMatch = await ledgerWebCanForRole(
    scope.orgId,
    session.user.role,
    "expense.confirm",
  );

  const [floating, unpaidBills] = await Promise.all([
    listFloatingPayments(scope.orgId, scope.companyId),
    listExpensesSummary({
      orgId: scope.orgId,
      companyId: scope.companyId,
      branchId: scope.branchId,
      status: ["confirmed", "locked"],
      paymentStatus: "unpaid",
      take: 300,
    }),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="สลิปจ่ายเงิน"
        subtitle={`${floating.length} สลิปรอจับคู่`}
        scope={scope}
      />
      <FloatingSlipList
        slips={floating}
        bills={unpaidBills.map((b) => ({
          id: b.id,
          docCode: b.docCode,
          vendor: b.vendor,
          total: b.total,
          docDate: b.docDate,
        }))}
        canMatch={canMatch}
      />
    </div>
  );
}
