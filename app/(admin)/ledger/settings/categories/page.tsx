// Ledger · ตั้งค่า › หมวดหมู่ค่าใช้จ่าย
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { listCategories } from "../../_data";
import { CategoryManager } from "../_components/CategoryManager";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

export default async function CategorySettingsPage({
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
        <LedgerHeader title="หมวดหมู่ค่าใช้จ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const categories = await listCategories(scope.orgId, scope.companyId);

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="หมวดหมู่ค่าใช้จ่าย"
        subtitle="จัดกลุ่ม · สี · ผูกรหัสบัญชี"
        scope={scope}
      />
      <div className="mx-auto max-w-2xl">
        <CategoryManager
          companyId={scope.companyId}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            trcloudAccCode: c.trcloudAccCode ?? null,
            trcloudProductCode: c.trcloudProductCode ?? null,
            vatClaimable: c.vatClaimable ?? true,
            sort: c.sort,
            active: c.active,
          }))}
        />
      </div>
    </div>
  );
}
