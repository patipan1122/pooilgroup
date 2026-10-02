// Per-user module access — controls who can see CashHub / FuelOS / DocuFlow.
//
// Admin tier (super_admin / org_admin / admin) bypasses the check entirely:
// they always see every active module so support / debugging works without
// adding rows. For everyone else, an active row in user_modules is required.
//
// Backfill: existing non-admin users were granted cashhub at migration time.

import { cache } from "react";
import { redirect } from "next/navigation";
import { adminClient } from "@/lib/db/server";
import type { DbUser } from "./session";
import type { ModuleSlug } from "@/lib/modules";
import { MODULES, isModuleDisabled } from "@/lib/modules";
// Single source of truth for admin-tier role membership lives in role-guards.
// Re-exported here so existing import sites (`@/lib/auth/module-access`) keep
// working — see feedback rule on module isolation / single source of truth.
import { isAdminTier, isExecutiveRole, isProgramAdminTier } from "./role-guards";

export { isAdminTier };

// Single source of truth for the canonical module slug list.
// Derived from MODULES registry so a new module added to `lib/modules.ts`
// is automatically visible to admin tier + accepted in the row filter
// below — no more "admin can't see new module" drift (BIGFEATURE §2.1).
const MODULE_SLUGS = new Set<ModuleSlug>(
  Object.keys(MODULES) as ModuleSlug[],
);

const CLAWFLEET_SLUG: ModuleSlug = "clawfleet";

/**
 * Self-healing ClawFleet entitlement.
 *
 * A user assigned to an active claw_machine branch must always be able to use
 * ClawFleet. Historically the staff-invite + invite-accept flow granted the
 * `role` + `user_branches` row but NEVER wrote the `user_modules[clawfleet]`
 * grant — so freshly invited field staff landed on an EMPTY hub home (no
 * program shown) and hit /403 when opening the ClawFleet app. This derives the
 * grant from branch assignment and persists it (idempotent upsert), so:
 *   - existing stuck staff heal on their very next page load, and
 *   - every future invite is covered — no migration or backfill required.
 *
 * Only runs when clawfleet isn't already granted, and never breaks the render
 * path: any failure is swallowed (the user simply keeps their current access).
 */
async function grantClawfleetIfBranchAssigned(
  admin: ReturnType<typeof adminClient>,
  user: DbUser,
  modules: Set<ModuleSlug>,
): Promise<void> {
  if (!MODULE_SLUGS.has(CLAWFLEET_SLUG)) return; // module not registered
  try {
    // Active branch assignments for this user.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ub } = await (admin.from as any)("user_branches")
      .select("branch_id")
      .eq("org_id", user.org_id)
      .eq("user_id", user.id)
      .eq("is_active", true);
    const branchIds = ((ub ?? []) as Array<{ branch_id: string }>).map(
      (r) => r.branch_id,
    );
    if (branchIds.length === 0) return;

    // Is any assigned branch a claw-machine branch?
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claw } = await (admin.from as any)("branches")
      .select("id")
      .eq("org_id", user.org_id)
      .eq("business_type", "claw_machine")
      .eq("is_active", true)
      .in("id", branchIds)
      .limit(1);
    if (!claw || (claw as unknown[]).length === 0) return;

    // Persist the grant — but PRESERVE an existing row's role: reactivating a
    // previously-deactivated grant must NOT demote a program-admin (role='admin')
    // back to 'member'. Check first → reactivate in place (role untouched) OR
    // insert a fresh member grant.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingGrant } = await (admin.from as any)("user_modules")
      .select("id, is_active")
      .eq("org_id", user.org_id)
      .eq("user_id", user.id)
      .eq("module_name", CLAWFLEET_SLUG)
      .maybeSingle();
    if (existingGrant) {
      if (!existingGrant.is_active) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from as any)("user_modules")
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq("id", existingGrant.id);
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from as any)("user_modules").insert({
        org_id: user.org_id,
        user_id: user.id,
        module_name: CLAWFLEET_SLUG,
        is_active: true,
        role: "member",
      });
    }
    modules.add(CLAWFLEET_SLUG);
  } catch {
    // Self-heal is best-effort — never block a page render on it.
  }
}

/**
 * Returns the set of modules the user can access. Admin tier sees all
 * known modules unconditionally; everyone else gets only the modules
 * granted in the user_modules table (where is_active = true).
 */
async function loadUserModulesUncached(
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

  // Self-heal ClawFleet access for field staff assigned to a claw-machine
  // branch (see grantClawfleetIfBranchAssigned). Skipped if already granted.
  if (!modules.has(CLAWFLEET_SLUG)) {
    await grantClawfleetIfBranchAssigned(admin, user, modules);
  }

  return modules;
}

// React cache() dedupes within a single request: the admin layout, /home and
// /programs all call loadUserModules(session.user) — without this that is up to
// 3 duplicate `user_modules` Supabase queries per hub navigation (non-admin
// users). Same discipline as getSession(); keyed by the session.user object
// identity, which is stable across the request because getSession() is also
// cache()'d.
export const loadUserModules = cache(loadUserModulesUncached);

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
 *   - user's global role is program_admin AND they have any active
 *     user_modules grant for this module (being granted the program IS
 *     the admin signal — no extra per-module flag needed), OR
 *   - user has a user_modules row for this module with role='admin' + active
 *     (lets a regular staff member be hand-picked as one module's admin
 *     without changing their global role).
 *
 * Exception — "clawfleet" (cash collection from claw machines): CEO decided
 * 2026-08-17 to keep this module at the stricter original rule, since a
 * program_admin of some OTHER program must not walk into cash handling just
 * because they were granted view access. For clawfleet, program_admin always
 * falls through to the same role='admin' check as everyone else below.
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
  if (user.role === "program_admin" && module !== "clawfleet") {
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

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped capability gates (2026-09-30) — additive OR-composition on
// top of the existing org-wide role gates in role-guards.ts
// (requireExecutiveRole / requireProgramAdminTier), extended so a
// user_modules GRANT can substitute for org-wide role tier, scoped to
// exactly the one module being gated.
//
// Why this exists: `inviteProgramStaff()` (lib/auth/program-invite.ts) mints
// a plain org-role "staff" user + a user_modules grant for one program. But
// EXECUTIVE_ROLES (role-guards.ts) excludes staff/driver entirely, and
// isProgramAdminTier() only ever checks org-wide role tier — neither
// consults the grant. Net effect: a freshly-invited staff member could not
// open a single page of the program they were just invited to, and even a
// module-admin-promoted staff (user_modules.role='admin') could not use
// that program's write actions.
//
// This is the SAME composition pattern already used ad-hoc at ~15
// RentSpace/ChairOps/ClawHub call sites — see the "ALREADY-CORRECT-COMPOSED"
// entries in lib/auth/role-gate-known-exceptions.ts, e.g.
// `isAdminTier(role) || (await userIsModuleAdmin(user, "rentspace"))` — just
// centralized here as a named, reusable pair instead of copy-pasted inline
// at every call site (a copy-pasted rule drifts — see
// [[feedback-one-rule-two-copies-drifts-2026-09-23]]).
//
// Deliberately does NOT touch role-guards.ts itself or any call site that
// isn't explicitly switched to use these — every existing
// requireExecutiveRole(role) / isProgramAdminTier(role) call anywhere in the
// app keeps its EXACT current behavior until a module opts in. Wired into
// DocuFlow's call sites as of this fix (2026-09-30); the other 15 programs
// that also use `inviteProgramStaff()` have the identical latent gap and can
// adopt the same one-line swap per call site when prioritized.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * View-tier check for one module's pages — true for the existing
 * EXECUTIVE_ROLES tier (no extra query), OR any active user_modules grant
 * (member or admin) for `module`. Lets a plain invited staff member view the
 * ONE program they were granted, without widening EXECUTIVE_ROLES itself.
 */
export async function userCanViewModule(
  user: DbUser,
  module: ModuleSlug,
): Promise<boolean> {
  if (isExecutiveRole(user.role)) return true;
  return userHasModuleAccess(user, module);
}

/** Redirect-on-fail wrapper around userCanViewModule.
 *
 * Deliberately redirects to /403, NOT requireExecutiveRole's own
 * "/cashhub/my-branches" target: that target assumes the blocked user
 * already has CashHub access (true historically — requireExecutiveRole's
 * only callers were CashHub itself, or DocuFlow users who happened to also
 * be cashhub-entitled). A user invited into a non-CashHub program via
 * inviteProgramStaff() has NO cashhub grant at all, so redirecting them to a
 * CashHub page would just trip CashHub's own module-entry gate and bounce
 * them again to /403 anyway — found via real click-through testing
 * (2026-09-30), not assumed. /403 gets there directly, no double-bounce. */
export async function requireModuleView(
  user: DbUser,
  module: ModuleSlug,
): Promise<void> {
  if (!(await userCanViewModule(user, module))) {
    redirect("/403");
  }
}

/**
 * Write/admin-tier check for one module — true for the existing
 * isProgramAdminTier tier (no extra query), OR userIsModuleAdmin (already
 * covers program_admin-with-any-grant AND a staff/branch_manager hand-picked
 * as this module's admin via user_modules.role='admin').
 */
export async function userCanAdminModule(
  user: DbUser,
  module: ModuleSlug,
): Promise<boolean> {
  if (isProgramAdminTier(user.role)) return true;
  return userIsModuleAdmin(user, module);
}

/** Redirect-on-fail wrapper around userCanAdminModule.
 *
 * Deliberately /403, not requireProgramAdminTier's "/cashhub/heatmap" target
 * — same reasoning as requireModuleView above (found via real click-through
 * testing 2026-09-30): a module-scoped invited staff member commonly has no
 * cashhub grant, so that target is a guaranteed second bounce to /403 for
 * them. /403 gets there directly. */
export async function requireModuleAdmin(
  user: DbUser,
  module: ModuleSlug,
): Promise<void> {
  if (!(await userCanAdminModule(user, module))) {
    redirect("/403");
  }
}
