// LedgerLine — /ledger/bank-recon/revenue : หน้าจัดการรายได้
// List + add + delete revenue entries (the "book in" side of reconciliation).
// Source: TRCloud IV sync, webhooks, or manual entry.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { ledgerBankReconV1, ledgerRevenueGlV1 } from "@/lib/ledger/flags";
import { prisma } from "@/lib/prisma";
import { RevenueManager } from "./_components/RevenueManager";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; period?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="จัดการรายได้" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }
  if (!ledgerBankReconV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="จัดการรายได้" scope={scope} />
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
          ระบบกระทบยอดธนาคารยังไม่เปิดใช้
        </div>
      </div>
    );
  }

  const orgId = session.user.org_id;
  const companyId = scope.companyId;
  const canEdit = ["super_admin", "org_admin", "admin"].includes(session.user.role);

  const now = new Date();
  const period = sp.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("th-TH", { year: "numeric", month: "long" });

  const rows = await prisma.$queryRaw<{
    id: string; entryDate: string; amountSatang: bigint; sourceType: string;
    sourceRef: string | null; description: string | null; customerName: string | null;
    matchState: string; inGroup: boolean;
  }[]>`
    SELECT r.id::text as id, r.entry_date::text as "entryDate", r.amount_satang as "amountSatang",
           r.source_type as "sourceType", r.source_ref as "sourceRef", r.description,
           r.customer_name as "customerName", r.match_state as "matchState",
           EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='revenue' AND mi.book_id=r.id) as "inGroup"
    FROM ledger_revenue_entry r
    WHERE r.org_id=${orgId}::uuid AND r.company_id=${companyId}::uuid
      AND r.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    ORDER BY r.entry_date DESC, r.amount_satang DESC
    LIMIT 500
  `;
  const entries = rows.map((r) => ({ ...r, amountSatang: Number(r.amountSatang) }));

  const prevM = new Date(year, month - 2, 1);
  const nextM = new Date(year, month, 1);
  const prevPeriod = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}`;
  const nextPeriod = nextM > now ? null : `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, "0")}`;
  const totalSatang = entries.reduce((s, e) => s + e.amountSatang, 0);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-2">
        <Link href={`/ledger/bank-recon?company=${companyId}`} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600">
          <ChevronLeft size={14} /> กลับหน้ากระทบยอด
        </Link>
      </div>
      <LedgerHeader
        title="จัดการรายได้"
        subtitle={`${entries.length} รายการ · รวม ฿${(totalSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`}
        scope={scope}
      />
      <RevenueManager
        companyId={companyId}
        canEdit={canEdit}
        entries={entries}
        period={period}
        periodLabel={periodLabel}
        prevPeriod={prevPeriod}
        nextPeriod={nextPeriod}
        glOn={ledgerRevenueGlV1()}
      />
    </div>
  );
}
