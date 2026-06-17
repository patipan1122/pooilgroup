// ClawHub (JOLLY PLAY) — admin access guard for the back-office (admin) surface.
//
// CEO principle [[program-admin-must-just-work]]: a program_admin granted the
// "clawhub" module gets full ClawHub admin — no hidden gate. So we allow the
// global admin tier (super_admin / org_admin / admin) OR a program_admin (any
// role) who holds an active clawhub module grant. Anyone else → /403.
//
// Use at the top of ClawHub admin server pages/layouts/actions:
//   const session = await requireClawhubAdmin();
//
// The customer-facing LIFF surface does NOT use this — members authenticate via
// LINE, not a DbUser session.

import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";

/**
 * Require an authenticated ClawHub admin. Returns the session on success;
 * redirects to /login (no session) or /403 (insufficient rights) otherwise.
 */
export async function requireClawhubAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");

  // Global admin tier always passes.
  if (isAdminTier(session.user.role)) return session;

  // program_admin (or any role) with an active "clawhub" module admin grant passes.
  const ok = await userIsModuleAdmin(session.user, "clawhub");
  if (!ok) redirect("/403");

  return session;
}
