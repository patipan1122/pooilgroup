// LedgerLine — /ledger/reconcile: the accountant's "ขอโอนเงิน → จ่าย → สลิป →
// กระทบยอด" worklist, and (LeanUX C1, 2026-06-09) the single home for slip work —
// /ledger/payments now redirects here so there's no orphan duplicate page.
//   • PAYREQ flow (LEDGER_PAYREQ_V1): the 4-bucket board + slip→request pairing.
//   • SLIP flow (LEDGER_SLIP_V1): floating slips paired DIRECTLY to a bill (for
//     bills paid without a payment request) — moved here from the old payments page.
// Read-only EXCEPT pairing a floating slip (assignSlipToRequestAction / matchFloatingSlip).
//
// Multi-tenant: every query is scoped by orgId AND companyId (resolved from the
// shared LedgerHeader picker) — never org-only. Pooil ↔ JP Sync are separate
// legal entities; an org-wide read would leak requests/slips across them.
import { requireRole } from "@/lib/auth/session";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { ledgerPayreqV1, ledgerSlipV1 } from "@/lib/ledger/flags";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listReconcile, listReconcileVendors } from "@/lib/ledger/payment-request-queries";
import { listExpensesSummary } from "../_data";
import { listFloatingPayments } from "@/lib/ledger/payments";
import { ReconcileBoard } from "./_components/ReconcileBoard";
import { ReconcileFilterBar } from "./_components/ReconcileFilterBar";
import { ReconcileExportButton } from "./_components/ReconcileExportButton";
import { FloatingSlipList } from "../payments/_components/FloatingSlipList";

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

  const payreqOn = ledgerPayreqV1();
  const slipOn = ledgerSlipV1();

  if (!payreqOn && !slipOn) {
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

  const canMatch = await ledgerWebCanForRole(
    scope.orgId,
    session.user.role,
    "expense.confirm",
  );

  // PAYREQ board data (only when that flow is on).
  const [board, vendorOptions] = payreqOn
    ? await Promise.all([
        listReconcile(scope.orgId, scope.companyId, {
          branchId: scope.branchId,
          month: month || null,
          vendors: vendors.length ? vendors : null,
        }),
        listReconcileVendors(scope.orgId, scope.companyId, scope.branchId),
      ])
    : [null, [] as Awaited<ReturnType<typeof listReconcileVendors>>];

  // SLIP→BILL data — floating slips + unpaid bills (moved here from /ledger/payments).
  const [floatingSlips, unpaidBills] = slipOn
    ? await Promise.all([
        listFloatingPayments(scope.orgId, scope.companyId),
        listExpensesSummary({
          orgId: scope.orgId,
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: ["confirmed", "locked"],
          paymentStatus: "unpaid",
          take: 300,
        }).then((r) => r.expenses),
      ])
    : [[] as Awaited<ReturnType<typeof listFloatingPayments>>, []];

  const totalCount = board
    ? board.summary.awaiting.count +
      board.summary.partial.count +
      board.summary.paid.count +
      board.summary.abnormal.count
    : 0;

  const subtitle = board
    ? `${totalCount} รายการ — รอโอน ${board.summary.awaiting.count} · ต้องตรวจ ${board.summary.abnormal.count}`
    : `${floatingSlips.length} สลิปรอจับคู่`;

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="กระทบยอดจ่าย"
        subtitle={subtitle}
        scope={scope}
        right={
          board ? (
            <ReconcileExportButton
              companyId={scope.companyId}
              branchId={scope.branchId ?? ""}
              month={month}
              vendors={vendors}
            />
          ) : undefined
        }
      />

      {board && (
        <>
          <ReconcileFilterBar
            branches={scope.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
            branchId={scope.branchId ?? ""}
            month={month}
            vendorOptions={vendorOptions}
            selectedVendors={vendors}
          />

          <ReconcileBoard
            awaiting={board.awaiting}
            partial={board.partial}
            paid={board.paid}
            abnormal={board.abnormal}
            floatingSlips={board.floatingSlips}
            summary={board.summary}
            canMatch={canMatch}
          />
        </>
      )}

      {/* สลิปลอย → จับกับบิลโดยตรง (บิลที่จ่ายเองไม่ผ่านคำขอโอน). ย้ายมาจากหน้า
          /ledger/payments เดิม (LeanUX C1) — รวมงานสลิปไว้ที่เดียว ไม่มีหน้า orphan. */}
      {slipOn && floatingSlips.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-1 text-sm font-bold text-zinc-800">
            สลิปลอย — จับกับบิลโดยตรง
          </h2>
          <p className="mb-2 text-xs text-zinc-400">
            สลิปที่ยังไม่ถูกจับคู่ · จับกับบิลที่จ่ายเองโดยตรง (ไม่ได้ผ่านคำขอโอน)
          </p>
          <FloatingSlipList
            slips={floatingSlips}
            bills={unpaidBills.map((b) => ({
              id: b.id,
              docCode: b.docCode,
              vendor: b.vendor,
              total: b.total,
              docDate: b.docDate,
            }))}
            canMatch={canMatch}
          />
        </section>
      )}
    </div>
  );
}
