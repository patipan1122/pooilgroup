// Ledger · ตั้งค่า — หมวดค่าใช้จ่าย (CRUD), ผูกกลุ่ม LINE (stub), export config.
// admin tier only (nav item is adminOnly); we also re-gate here.
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listCategories } from "../_data";
import { CategoryManager } from "./_components/CategoryManager";
import { LineChannelCard } from "./_components/LineChannelCard";
import { ExportConfigCard } from "./_components/ExportConfigCard";

export const dynamic = "force-dynamic";

export default async function LedgerSettingsPage({
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
        <LedgerHeader title="ตั้งค่า" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const categories = await listCategories(scope.orgId, scope.companyId);

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="ตั้งค่า"
        subtitle="หมวดค่าใช้จ่าย · กลุ่ม LINE · การส่งออก"
        scope={scope}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <CategoryManager
            companyId={scope.companyId}
            categories={categories.map((c) => ({
              id: c.id,
              name: c.name,
              color: c.color,
              trcloudAccCode: c.trcloudAccCode ?? null,
              sort: c.sort,
              active: true,
            }))}
          />
        </div>
        <LineChannelCard companyName={scope.companies.find((c) => c.id === scope.companyId)?.name ?? ""} />
        <ExportConfigCard companyId={scope.companyId} />
      </div>
    </div>
  );
}
