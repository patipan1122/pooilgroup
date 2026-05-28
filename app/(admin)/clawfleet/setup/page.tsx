// ClawFleet · Workspace 4 — Setup (admin-only)
// Tabbed surface merging settings + structure + users + org + audit + danger.
// Spec: docs/AUDIT_clawfleet_2026-05-25.md §3.6, §7.2 (Settings) — gear-icon pattern.
//
// Server Component shell. Pre-fetches the data each panel needs (parallel)
// then hands off to the client <SetupTabs>. Mutations go through Server
// Actions invoked from within the panels.

import { Settings as SettingsIcon } from "lucide-react";
import { assertCfAdmin } from "@/lib/clawfleet/role-guard";
import { isModuleDisabled } from "@/lib/modules";
import { redirect } from "next/navigation";
import {
  listAccessibleBranches,
  listGroups,
  listMachines,
  listProducts,
} from "@/lib/clawfleet/queries";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/ui/back-button";
import { SetupTabs } from "@/components/clawfleet/setup/setup-tabs";

export const dynamic = "force-dynamic";

const VALID_TABS = [
  "system",
  "structure",
  "import",
  "users",
  "org",
  "audit",
  "danger",
] as const;
type SetupTab = (typeof VALID_TABS)[number];

export default async function ClawfleetSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  const session = await assertCfAdmin();

  const params = await searchParams;
  const tab: SetupTab = (VALID_TABS as readonly string[]).includes(params.tab ?? "")
    ? (params.tab as SetupTab)
    : "system";

  // Parallel pre-fetch — each panel only consumes what it needs.
  const [branches, groups, machines, products, org, users, recentAudit] =
    await Promise.all([
      listAccessibleBranches(),
      listGroups(),
      listMachines({}),
      listProducts(),
      prisma.organization.findUnique({
        where: { id: session.user.org_id },
        select: {
          id: true,
          name: true,
          slug: true,
          lineOaId: true,
          telegramChatId: true,
          settings: true,
        },
      }),
      // Users with any ClawFleet branch access
      prisma.user.findMany({
        where: {
          orgId: session.user.org_id,
          isActive: true,
          userBranches: {
            some: { branch: { businessType: "claw_machine" } },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          lastLoginAt: true,
          userBranches: {
            where: { branch: { businessType: "claw_machine" } },
            select: {
              branch: { select: { id: true, name: true, code: true } },
            },
          },
        },
        orderBy: { name: "asc" },
        take: 100,
      }),
      // Recent audit entries (Pool's shared AuditLog · filtered by cf_ prefix)
      prisma.auditLog.findMany({
        where: {
          orgId: session.user.org_id,
          OR: [
            { resourceType: { startsWith: "cf_" } },
            { action: { startsWith: "CF_" } },
          ],
        },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

  const orgConfig = {
    id: org?.id ?? session.user.org_id,
    name: org?.name ?? "—",
    slug: org?.slug ?? "—",
    lineOaId: org?.lineOaId ?? null,
    telegramChatId: org?.telegramChatId ?? null,
    cronSecretSet: Boolean(process.env.CRON_SECRET),
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Page header — sticky z-30, solid white (per tokens.md) */}
      <div className="sticky top-0 z-30 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <SettingsIcon className="size-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">
                ตั้งค่า ClawFleet
              </h1>
              <p className="text-xs text-zinc-500">
                เฉพาะแอดมิน · ระบบ · โครงสร้าง · ผู้ใช้ · บัญชี · audit log · danger zone
              </p>
            </div>
          </div>
          <BackButton label="กลับ" fallbackHref="/clawfleet/dashboard" />
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <SetupTabs
          activeTab={tab}
          branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
          groups={groups.map((g) => ({
            id: g.id,
            name: g.name,
            branchId: g.branchId,
            branchName: g.branch.name,
            machineCount: g._count.machines,
            sessionCount: g._count.sessions,
            toleranceBps: g.toleranceBps,
            exchangerCode: g.exchanger?.code ?? null,
          }))}
          machines={machines.map((m) => ({
            id: m.id,
            code: m.code,
            kind: m.kind,
            branchName: m.branch.name,
            isActive: m.isActive,
          }))}
          products={products.map((p) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category,
            defaultPriceCoins: p.defaultPriceCoins,
          }))}
          users={users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
            branches: u.userBranches.map((ub) => ({
              id: ub.branch.id,
              name: ub.branch.name,
              code: ub.branch.code,
            })),
          }))}
          orgConfig={orgConfig}
          recentAudit={recentAudit.map((a) => ({
            id: a.id,
            action: a.action,
            resourceType: a.resourceType,
            resourceId: a.resourceId,
            createdAt: a.createdAt.toISOString(),
            actor: a.user
              ? { id: a.user.id, name: a.user.name, email: a.user.email }
              : null,
          }))}
        />
      </div>
    </div>
  );
}
