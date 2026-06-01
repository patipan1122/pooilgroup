// Per-user module access — controls who can see CashHub / FuelOS / DocuFlow.
//
// Admin tier (super_admin / org_admin / admin) bypasses the check entirely:
// they always see every active module so support / debugging works without
// adding rows. For everyone else, an active row in user_modules is required.
//
// Backfill: existing non-admin users were granted cashhub at migration time.

import { redirect } from "next/navigation";
import { adminClient } from "@/lib/db/server";
import type { DbUser } from "./session";
import type { ModuleSlug } from "@/lib/modules";
import { MODULES, isModuleDisabled } from "@/lib/modules";
// Single source of truth for admin-tier role membership lives in role-guards.
// Re-exported here so existing import sites (`@/lib/auth/module-access`) keep
// working — see feedback rule on module isolation / single source of truth.
import { isAdminTier } from "./role-guards";

export { isAdminTier };

// Single source of truth for the canonical module slug list.
// Derived from MODULES registry so a new module added to `lib/modules.ts`
// is automatically visible to admin tier + accepted in the row filter
// below — no more "admin can't see new module" drift (BIGFEATURE §2.1).
const MODULE_SLUGS = new Set<ModuleSlug>(
  Object.keys(MODULES) as ModuleSlug[],
);

/**
 * Returns the set of modules the user can access. Admin tier sees all
 * known modules unconditionally; everyone else gets only the modules
 * granted in the user_modules table (where is_active = true).
 */
export async function loadUserModules(
  user: DbUser,
): Promise<Set<ModuleSlug>> {
  if (isAdminTier(user.role)) {
    return new Set<ModuleSlug>(MODULE_SLUGS);
  }

  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from as any)("user_modules")
    .select("module_name")
    .eq("org_id", user.org_id)
    .eq("user_id", user.id)
    .eq("is_active", true);

  const modules = new Set<ModuleSlug>();
  for (const row of (data ?? []) as Array<{ module_name: string }>) {
    if (MODULE_SLUGS.has(row.module_name as ModuleSlug)) {
      modules.add(row.module_name as ModuleSlug);
    }
  }
  return modules;
}

/**
 * Single-module check — convenience wrapper around loadUserModules.
 * Use in module page guards. Cheap: admin tier returns true without a query.
 */
export async function userHasModuleAccess(
  user: DbUser,
  module: ModuleSlug,
): Promise<boolean> {
  if (isAdminTier(user.role)) return true;

  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from as any)("user_modules")
    .select("id")
    .eq("org_id", user.org_id)
    .eq("user_id", user.id)
    .eq("module_name", module)
    .eq("is_active", true)
    .maybeSingle();

  return !!data;
}

/**
 * Is this user an ADMIN of the given module (can manage its sub-members)?
 *
 * True when:
 *   - user is global admin tier (super_admin / org_admin / admin), OR
 *   - user has a user_modules row for this module with role='admin' + active.
 *
 * Use INSIDE a module to gate "invite teammate / manage members" actions,
 * so a program admin can run their own program without being a global admin.
 */
export async function userIsModuleAdmin(
  user: DbUser,
  module: ModuleSlug,
): Promise<boolean> {
  if (isAdminTier(user.role)) return true;

  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from as any)("user_modules")
    .select("id")
    .eq("org_id", user.org_id)
    .eq("user_id", user.id)
    .eq("module_name", module)
    .eq("role", "admin")
    .eq("is_active", true)
    .maybeSingle();

  return !!data;
}

/**
 * One-call guard for module layouts. Combines the kill switch
 * (`MODULES_DISABLED` env) with the per-user entitlement check.
 * Redirects to /dashboard if the module is globally disabled,
 * or to /403 if the user lacks entitlement. Returns silently when
 * access is granted.
 *
 * Use inside server layout files:
 *   export default async function CashHubLayout({ children }) {
 *     await assertModuleEnabled("cashhub");
 *     return <>{children}</>;
 *   }
 */
export async function assertModuleEnabled(slug: ModuleSlug): Promise<void> {
  if (isModuleDisabled(slug)) {
    redirect("/dashboard");
  }
  // Late import to avoid circular dependency with session helpers.
  const { requireSession } = await import("./session");
  const session = await requireSession();
  if (isAdminTier(session.user.role)) return;
  const ok = await userHasModuleAccess(session.user, slug);
  if (!ok) redirect("/403");
}
