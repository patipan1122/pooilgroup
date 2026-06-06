// Ledger · ตั้งค่า (หน้ารวม) — a tappable hub that drills into focused sub-pages
// (หมวดหมู่ · สมาชิก · สิทธิ์ · สาขา · กลุ่ม LINE · ส่งออก). Replaces the old
// one-long-scroll. admin tier only (nav item is adminOnly); we also re-gate here.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import {
  listCategories,
  getLineChannel,
  listInvites,
  listLedgerMembers,
  listLedgerGroups,
} from "../_data";
import { SettingsHub, type HubCounts } from "./_components/SettingsHub";

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

  const [categories, members, groups, invites, lineChannel] = await Promise.all([
    listCategories(scope.orgId, scope.companyId),
    listLedgerMembers(scope.orgId, scope.companyId),
    listLedgerGroups(scope.orgId, scope.companyId),
    listInvites(scope.orgId, scope.companyId),
    getLineChannel(scope.orgId, scope.companyId),
  ]);

  const counts: HubCounts = {
    categories: categories.length,
    members: members.length,
    pendingMembers: members.filter((m) => m.pendingBranchId).length,
    invites: invites.length,
    branches: scope.branches.length,
    groups: groups.length,
    lineConnected: !!lineChannel?.hasAccessToken,
  };

  const expensesHref = `/ledger/expenses?company=${encodeURIComponent(scope.companyId)}`;

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <Link
        href={expensesHref}
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition hover:text-zinc-800"
      >
        <ChevronLeft className="size-4" aria-hidden />
        รายการค่าใช้จ่าย
      </Link>
      <LedgerHeader
        title="ตั้งค่า"
        subtitle="จัดการระบบบัญชี · ทีม · การเชื่อมต่อ LINE"
        scope={scope}
      />
      <SettingsHub companyId={scope.companyId} counts={counts} />
    </div>
  );
}
