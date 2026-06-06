// Ledger · ตั้งค่า › สมาชิก & คำเชิญ (+ ยืนยันตัวตน "นี่คือ LINE ของฉัน")
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { listLedgerMembers, listInvites } from "../../_data";
import { MemberManager } from "../_components/MemberManager";
import { InviteManager } from "../_components/InviteManager";
import { IdentityClaimCard } from "../_components/IdentityClaimCard";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

export default async function MemberSettingsPage({
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
        <LedgerHeader title="สมาชิก & คำเชิญ" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const [members, invites] = await Promise.all([
    listLedgerMembers(scope.orgId, scope.companyId),
    listInvites(scope.orgId, scope.companyId),
  ]);
  const branchOpts = scope.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }));

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="สมาชิก & คำเชิญ"
        subtitle="ใครเข้าใช้ระบบได้บ้าง · อนุมัติ/เชิญสมาชิก"
        scope={scope}
      />
      <div className="mx-auto max-w-2xl space-y-4">
        <IdentityClaimCard companyId={scope.companyId} />
        <MemberManager
          companyId={scope.companyId}
          branches={branchOpts}
          members={members}
          myUserId={session.user.id}
          myLineLinked={!!session.user.line_user_id}
        />
        <InviteManager
          companyId={scope.companyId}
          branches={branchOpts}
          invites={invites}
        />
      </div>
    </div>
  );
}
