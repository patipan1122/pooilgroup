// Ledger · ตั้งค่า › กลุ่ม LINE → สาขา — ดูกลุ่มไลน์ที่บอทอยู่ + ผูกแต่ละกลุ่มเข้าสาขา,
// เชื่อมต่อ LINE OA, และตั้ง Rich Menu.
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { getLineChannel, listLedgerGroups } from "../../_data";
import { GroupBranchManager } from "../_components/GroupBranchManager";
import { LineChannelCard } from "../_components/LineChannelCard";
import { RichMenuButton } from "../_components/RichMenuButton";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

export default async function LineGroupsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  // ผูก LINE channel / กลุ่ม LINE → สาขา = โครงสร้างการเชื่อมต่อ → super_admin เท่านั้น
  const session = await requireRole("super_admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <SettingsBack companyId={null} />
        <LedgerHeader title="กลุ่ม LINE → สาขา" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const [lineChannel, groups] = await Promise.all([
    getLineChannel(scope.orgId, scope.companyId),
    listLedgerGroups(scope.orgId, scope.companyId),
  ]);
  const branchOpts = scope.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const companyName = scope.companies.find((c) => c.id === scope.companyId)?.name ?? "";

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="กลุ่ม LINE → สาขา"
        subtitle="ดูกลุ่มไลน์ที่บอทอยู่ + ผูกแต่ละกลุ่มเข้าสาขา"
        scope={scope}
      />
      <div className="mx-auto max-w-2xl space-y-4 animate-fade-in">
        <GroupBranchManager
          companyId={scope.companyId}
          groups={groups}
          branches={branchOpts}
        />
        <LineChannelCard
          companyId={scope.companyId}
          companyName={companyName}
          channel={lineChannel}
          branches={branchOpts}
        />
        <RichMenuButton
          companyId={scope.companyId}
          connected={!!lineChannel?.hasAccessToken}
          alreadySet={!!lineChannel?.richMenuId}
        />
      </div>
    </div>
  );
}
