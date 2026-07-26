// LedgerLine · /ledger/to-pay — "บิลที่ต้องจ่าย": รวมคำขอโอนที่ยังไม่จ่าย (open) +
//   จ่ายบางส่วน (partial) ในจอเดียว สำหรับ CEO เปิดดูแล้วโอนตามได้เลย (เงินโอนจริง
//   CEO กดเองผ่านแอปธนาคาร — หน้านี้แค่รวบรวม + เตือนซ้ำ, ไม่แตะเงิน/ไม่เขียน TRCloud).
// Multi-tenant: scoped by orgId + companyId (LedgerHeader picker) เสมอ.
import { requireRole } from "@/lib/auth/session";
import { ledgerPayreqV1 } from "@/lib/ledger/flags";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listToPay } from "@/lib/ledger/to-pay-queries";
import { ToPayList } from "./_components/ToPayList";

export const dynamic = "force-dynamic";

export default async function ToPayPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="บิลที่ต้องจ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  if (!ledgerPayreqV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="บิลที่ต้องจ่าย" scope={scope} />
        <div className="mt-4 rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-500">
          ระบบ “ขอโอนเงิน” ยังไม่เปิดใช้งาน
        </div>
      </div>
    );
  }

  const data = await listToPay(session.user.org_id, scope.companyId, { branchId: scope.branchId });

  return (
    <div className="space-y-4 p-4 sm:px-6 sm:pt-4 sm:pb-6">
      <LedgerHeader
        title="บิลที่ต้องจ่าย"
        subtitle="รวมทุกใบที่รอโอน · เรียงจากค้างนานสุด · เปิดดูเลขบัญชี/QR แล้วโอนได้เลย"
        scope={scope}
      />
      <ToPayList data={data} />
    </div>
  );
}
