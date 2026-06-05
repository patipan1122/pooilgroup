// LedgerLine — LIFF Mobile Admin Console · /liff/ledger/admin (GAP 5)
//
// "จัดการทีม" — the whole LedgerLine admin surface, mobile-first, opened inside
// LINE via LIFF (Bainy-style). Auth comes from the /liff layout's LiffBootstrap
// (verified LINE id_token → Pool session). This SERVER shell:
//   1. resolves the session (waiting state while LiffBootstrap logs in),
//   2. GATES to admin-tier (non-admins see a friendly "เฉพาะผู้ดูแล" screen —
//      the Rich Menu button is shared, so staff can land here),
//   3. loads every company-scoped dataset the console needs,
//   4. renders the client console (tabs + bottom-nav).
//
// Reuses the EXISTING, deployed server actions + managers (no dead UI): the same
// updateMemberBranches / createLedgerInvite / createCategory / connectLineChannel
// the web settings use. New mobile pieces (permission toggles, branch/org edit)
// layer on top in later phases.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { listCompanies, listCategories } from "@/lib/ledger/queries";
import {
  getLineChannel,
  listInvites,
  listLedgerMembers,
} from "@/app/(admin)/ledger/_data";
import { getPermissionMatrix } from "@/lib/ledger/permissions";
import { LedgerMascot } from "@/components/ledger/Brand";
import { AdminConsole } from "./_components/AdminConsole";

export const dynamic = "force-dynamic";

export default async function LedgerLiffAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await getSession();

  // Not signed in yet → LiffBootstrap (in /liff layout) logs in & re-renders.
  if (!session) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="size-12 animate-spin rounded-full border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-800">กำลังเข้าสู่ระบบ</p>
          <p className="text-sm text-zinc-500">
            ถ้าค้างนาน · บัญชีนี้อาจยังไม่ได้เปิดใช้ · ติดต่อออฟฟิศ
          </p>
        </div>
      </div>
    );
  }

  // Admin gate — Pool role is the source of truth for settings authz (workshop
  // W-013: never gate settings on the LINE-side role). Staff/accountant who tap
  // the shared Rich Menu button land on a calm "for admins only" screen.
  if (!isAdminTier(session.user.role)) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <LedgerMascot size={92} pose="confused" priority />
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-zinc-900">หน้านี้สำหรับผู้ดูแล</h1>
          <p className="text-sm text-zinc-500">
            การจัดการทีม/สิทธิ์/สาขา ทำได้เฉพาะผู้ดูแลระบบ · ถ้าต้องการสิทธิ์ ติดต่อผู้ดูแลของบริษัท
          </p>
        </div>
        <Link
          href="/liff/ledger"
          className="rounded-xl bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-semibold text-white active:bg-[var(--color-brand-700)]"
        >
          กลับไปถ่ายใบเสร็จ
        </Link>
      </div>
    );
  }

  const orgId = session.user.org_id;
  const sp = await searchParams;

  // Company context — default to the first company; ?company= overrides.
  const companies = await listCompanies(orgId).catch(() => []);
  if (companies.length === 0) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <LedgerMascot size={88} pose="welcome" priority />
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-800">ยังไม่มีบริษัท</p>
          <p className="text-sm text-zinc-500">
            สร้างบริษัทแรกในเมนู “ตั้งค่า” ของ LedgerLine บนเว็บก่อน
          </p>
        </div>
      </div>
    );
  }
  const companyId =
    (sp.company && companies.find((c) => c.id === sp.company)?.id) ||
    companies[0].id;
  const companyName = companies.find((c) => c.id === companyId)?.name ?? "";

  // Load everything the console needs for this company, in parallel.
  const [members, invites, categories, branchesFull, channel, permissionMatrix, companyDetail] =
    await Promise.all([
      listLedgerMembers(orgId, companyId),
      listInvites(orgId, companyId),
      listCategories(orgId, companyId),
      prisma.branch.findMany({
        where: { orgId, companyId },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, province: true, isActive: true },
      }),
      getLineChannel(orgId, companyId),
      getPermissionMatrix(orgId),
      prisma.company.findFirst({
        where: { id: companyId, orgId },
        select: { id: true, name: true, taxId: true, address: true, phone: true },
      }),
    ]);

  // Chip selectors (members/invite/line) use the active branches as {id,code,name}.
  const branchOpts = branchesFull
    .filter((b) => b.isActive)
    .map((b) => ({ id: b.id, code: b.code, name: b.name }));

  return (
    <AdminConsole
      companyId={companyId}
      companyName={companyName}
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      company={companyDetail ?? { id: companyId, name: companyName, taxId: null, address: null, phone: null }}
      members={members}
      invites={invites}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        trcloudAccCode: c.trcloudAccCode ?? null,
        sort: c.sort,
        active: true,
      }))}
      branchOpts={branchOpts}
      branchesFull={branchesFull}
      channel={channel}
      permissionMatrix={permissionMatrix}
      myUserId={session.user.id}
      myLineLinked={!!session.user.line_user_id}
    />
  );
}
