// Shared "deactivate a user account" mechanics — soft-delete + force-logout.
// Extracted from app/api/admin/users/[id]/route.ts's DELETE handler so a
// second call site (the DocuFlow external-signer revoke action,
// lib/docuflow/invite-signer.ts) reuses the EXACT same primitives instead of
// a copy-pasted near-duplicate — see
// [[feedback-one-rule-two-copies-drifts-2026-09-23]]: two copies of the same
// rule always drift apart over time.
//
// Callers remain responsible for their OWN authorization checks (who's
// allowed to deactivate whom) and their own audit log entry (the diff shape
// differs per call site) — this helper only does the mechanical side effects.

import type { adminClient } from "@/lib/db/server";

/**
 * Deactivate a user account:
 *   - mark all active `user_sessions` rows revoked (force logout)
 *   - set `users.is_active = false`
 *   - best-effort invalidate Supabase Auth refresh tokens
 *
 * Does NOT check permissions, does NOT check "last super_admin" guards, does
 * NOT write an audit log entry — callers do that themselves first.
 */
export async function deactivateUserAccount(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();

  await admin
    .from("user_sessions")
    .update({ is_revoked: true, logout_at: now })
    .eq("user_id", userId)
    .is("logout_at", null);

  await admin
    .from("users")
    .update({ is_active: false, updated_at: now })
    .eq("id", userId);

  try {
    await admin.auth.admin.signOut(userId, "global");
  } catch {
    // signOut may fail if no active session — ignore, sessions table is the
    // real gate (middleware checks is_revoked, not Supabase Auth state).
  }
}
