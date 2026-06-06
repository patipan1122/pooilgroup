// Ledger · ตั้งค่า › ส่งออก & โปรแกรมบัญชี — export/TRCloud config.
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { ExportConfigCard } from "../_components/ExportConfigCard";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

export default async function ExportSettingsPage({
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
        <LedgerHeader title="ส่งออก & โปรแกรมบัญชี" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="ส่งออก & โปรแกรมบัญชี"
        subtitle="ตั้งค่าไฟล์ส่งบัญชี / TRCloud"
        scope={scope}
      />
      <div className="mx-auto max-w-2xl">
        <ExportConfigCard companyId={scope.companyId} />
      </div>
    </div>
  );
}
