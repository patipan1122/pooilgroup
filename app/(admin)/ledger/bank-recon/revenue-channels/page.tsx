// LedgerLine — /ledger/bank-recon/revenue-channels: ตั้งค่าผังบัญชีรายได้ (channel→GL).
// Per business, map each payment channel (เงินสด/โอน/บัตร/QR/...) → the GL account
// the money lands in (clearing) + optional income GL + fee (MDR) GL. This config
// feeds lib/ledger/revenue-channel.ts which STAMPS an immutable GL snapshot on each
// revenue entry — editing here only affects FUTURE revenue, never historical rows.
//
// Sibling of accounts/page.tsx — same header, flag gate, back-link, NoCompanyState.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { ledgerRevenueGlV1 } from "@/lib/ledger/flags";
import { prisma } from "@/lib/prisma";
import { ChannelGlManager } from "./_components/ChannelGlManager";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RevenueChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  // View = admin tier; write (mapping) = super_admin only (gated in the manager + action).
  const session = await requireRole("super_admin", "org_admin", "admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="ผังบัญชีรายได้" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  if (!ledgerRevenueGlV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="ผังบัญชีรายได้" scope={scope} />
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
          ระบบผังบัญชีรายได้ยังไม่เปิดใช้
        </div>
      </div>
    );
  }

  const companyId = scope.companyId;
  // Mapping write = super_admin only (accountant audit lens). admin/org_admin view-only.
  const canEdit = session.user.role === "super_admin";

  // Existing per-channel mappings for this company (≤7 rows). org+company scoped.
  const rows = await prisma.$queryRaw<{
    channelCode: string;
    glClearing: string | null;
    glIncome: string | null;
    glFee: string | null;
    categoryId: string | null;
    categoryName: string | null;
    label: string | null;
    isActive: boolean;
  }[]>`
    SELECT
      g.channel_code      as "channelCode",
      g.gl_clearing       as "glClearing",
      g.gl_income         as "glIncome",
      g.gl_fee            as "glFee",
      g.category_id::text as "categoryId",
      c.name              as "categoryName",
      g.label,
      g.is_active         as "isActive"
    FROM ledger_revenue_channel_gl g
    LEFT JOIN ledger_category c
      ON c.id = g.category_id AND c.org_id = g.org_id AND c.company_id = g.company_id
    WHERE g.org_id = ${session.user.org_id}::uuid
      AND g.company_id = ${companyId}::uuid
  `;

  const configuredCount = rows.filter((r) => r.isActive && r.glClearing).length;

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
        title="ผังบัญชีรายได้"
        subtitle={`ตั้งค่าแล้ว ${configuredCount} / 7 ช่องทาง`}
        scope={scope}
      />

      <ChannelGlManager
        companyId={companyId}
        canEdit={canEdit}
        rows={rows}
      />
    </div>
  );
}
