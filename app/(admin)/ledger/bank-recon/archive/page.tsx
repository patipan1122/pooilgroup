// LedgerLine — /ledger/bank-recon/archive
// คลัง (รายการที่กระทบยอดแล้ว): searchable archive of confirmed + reversed
// match groups, with super_admin "ย้อนกลับ" / others "ขออนุมัติแก้".

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listMatchedArchive } from "@/lib/ledger/recon-controls";
import { BankReconControlsNav } from "../_components/BankReconControlsNav";
import { Archive, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArchiveClient } from "./ArchiveClient";

export const dynamic = "force-dynamic";

export default async function BankReconArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; q?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!ledgerBankReconV1() || !scope.companyId) redirect("/ledger/bank-recon");
  const orgId = session.user.org_id;
  const companyId = scope.companyId;
  const search = (sp.q ?? "").trim();

  const groups = await listMatchedArchive({ orgId, companyId, search: search || undefined });
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
          <Archive size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">คลัง (รายการที่กระทบยอดแล้ว)</h1>
          <p className="text-xs text-zinc-400">ค้นหารายการที่ยืนยัน/ย้อนแล้ว · ย้อนกลับได้ถ้าจับคู่ผิด</p>
        </div>
      </div>

      <BankReconControlsNav companyId={companyId} active="archive" />

      <ArchiveClient groups={groups} initialQuery={search} companyId={companyId} isSuper={isSuper} />
    </div>
  );
}
