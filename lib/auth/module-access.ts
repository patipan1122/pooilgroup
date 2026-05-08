// Per-user module access — controls who can see CashHub / FuelOS / DocuFlow.
//
// Admin tier (super_admin / org_admin / admin) bypasses the check entirely:
// they always see every active module so support / debugging works without
// adding rows. For everyone else, an active row in user_modules is required.
//
// Backfill: existing non-admin users were granted cashhub at migration time.

import { adminClient } from "@/lib/db/server";
import type { DbUser } from "./session";
import type { ModuleSlug } from "@/lib/modules";
// Single source of truth for admin-tier role membership lives in role-guards.
// Re-exported here so existing import sites (`@/lib/auth/module-access`) keep
// working — see feedback rule on module isolation / single source of truth.
import { isAdminTier } from "./role-guards";

export { isAdminTier };

/**
 * Returns the set of modules the user can access. Admin tier sees all
 * known modules unconditionally; everyone else gets only the modules
 * granted in the user_modules table (where is_active = true).
 */
export async function loadUserModules(
  user: DbUser,
): Promise<Set<ModuleSlug>> {
  if (isAdminTier(user.role)) {
    return new Set<ModuleSlug>(["cashhub", "fuelos", "docuflow"]);
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
    if (
      row.module_name === "cashhub" ||
      row.module_name === "fuelos" ||
      row.module_name === "docuflow"
    ) {
      modules.add(row.module_name);
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
