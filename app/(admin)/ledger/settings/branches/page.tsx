// Ledger · ตั้งค่า › สาขา — add/edit branches. Branch is a SHARED Pool entity
// (chairops/clawfleet/fuel use it) → the panel warns edits affect every module.
// Reuses the SAME BranchPanel as the LINE admin console (single source of truth).
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { BranchPanel } from "@/app/liff/ledger/admin/_components/BranchPanel";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

export default async function BranchSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <SettingsBack companyId={null} />
        <LedgerHeader title="สาขา" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const branchesFull = await prisma.branch.findMany({
    where: { orgId: scope.orgId, companyId: scope.companyId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, province: true, isActive: true },
  });

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="สาขา"
        subtitle="เพิ่ม/แก้สาขา (ใช้ร่วมกับทุกระบบ)"
        scope={scope}
      />
      <div className="mx-auto max-w-2xl">
        <BranchPanel companyId={scope.companyId} branches={branchesFull} />
      </div>
    </div>
  );
}
