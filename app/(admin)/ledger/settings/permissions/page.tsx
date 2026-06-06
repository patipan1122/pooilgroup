// Ledger · ตั้งค่า › สิทธิ์การใช้งาน — money-capability toggles per role.
// Reuses the SAME PermissionPanel + getPermissionMatrix as the LINE admin console
// so web and LINE never diverge. Permission rows are org-wide (not per-company).
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { getPermissionMatrix } from "@/lib/ledger/permissions";
import { PermissionPanel } from "@/app/liff/ledger/admin/_components/PermissionPanel";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

export default async function PermissionSettingsPage({
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
        <LedgerHeader title="สิทธิ์การใช้งาน" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const matrix = await getPermissionMatrix(scope.orgId);

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="สิทธิ์การใช้งาน"
        subtitle="แต่ละบทบาททำอะไรได้บ้าง (ยืนยัน/ส่งออก/ดูกำไร)"
        scope={scope}
      />
      <div className="mx-auto max-w-2xl">
        <PermissionPanel matrix={matrix} />
      </div>
    </div>
  );
}
