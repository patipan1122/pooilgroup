// Ledger · ตั้งค่า › ทีม & สิทธิ์ — LeanUX C2 (2026-06-09): merges the old
// "สมาชิก & คำเชิญ" and "สิทธิ์การใช้งาน" pages into one tabbed surface (same mental
// model: who's on the team + what each role may do). ?tab=members (default) | permissions.
// /ledger/settings/permissions redirects here with ?tab=permissions.
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { listLedgerMembers, listInvites } from "../../_data";
import { getPermissionMatrix } from "@/lib/ledger/permissions";
import { MemberManager } from "../_components/MemberManager";
import { InviteManager } from "../_components/InviteManager";
import { IdentityClaimCard } from "../_components/IdentityClaimCard";
import { PermissionPanel } from "@/app/liff/ledger/admin/_components/PermissionPanel";
import { SettingsBack } from "../_components/SettingsBack";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "members", label: "สมาชิก" },
  { key: "permissions", label: "สิทธิ์" },
] as const;

export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; tab?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <SettingsBack companyId={null} />
        <LedgerHeader title="ทีม & สิทธิ์" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const tab = sp.tab === "permissions" ? "permissions" : "members";

  const scopeQs = new URLSearchParams();
  if (sp.company) scopeQs.set("company", sp.company);
  if (sp.branch) scopeQs.set("branch", sp.branch);
  const tabHref = (t: string) => {
    const u = new URLSearchParams(scopeQs);
    if (t !== "members") u.set("tab", t);
    const s = u.toString();
    return s ? `?${s}` : "?";
  };

  const branchOpts = scope.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }));

  let body: React.ReactNode;
  if (tab === "permissions") {
    const matrix = await getPermissionMatrix(scope.orgId);
    body = <PermissionPanel matrix={matrix} />;
  } else {
    const [members, invites] = await Promise.all([
      listLedgerMembers(scope.orgId, scope.companyId),
      listInvites(scope.orgId, scope.companyId),
    ]);
    body = (
      <div className="space-y-4">
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
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="ทีม & สิทธิ์"
        subtitle={
          tab === "permissions"
            ? "แต่ละบทบาททำอะไรได้บ้าง (ยืนยัน/ส่งออก/ดูกำไร)"
            : "ใครเข้าใช้ระบบได้ · เชิญ/อนุมัติสมาชิก"
        }
        scope={scope}
      />
      <div className="mx-auto max-w-2xl">
        <nav
          aria-label="ทีม & สิทธิ์"
          className="mb-4 inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Link
                key={t.key}
                aria-current={active ? "page" : undefined}
                href={tabHref(t.key)}
                scroll={false}
                className={cn(
                  "inline-flex min-h-[36px] items-center rounded-lg px-4 text-sm font-medium transition-colors",
                  active
                    ? "bg-white text-[var(--color-brand-700)] shadow-sm ring-1 ring-zinc-200"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {body}
      </div>
    </div>
  );
}
