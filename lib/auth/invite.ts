// Shared "invite-link" primitives — create a pending user row (is_active=false)
// bound to a 48h token, and grant module-admin access (user_modules role='admin').
// Extracted so module-scoped invite flows (e.g. Recruit self-serve team invite,
// see app/(admin)/recruit/settings/team-actions.ts) don't reimplement the token
// format / expiry / upsert semantics used by the org-wide /api/admin/users flow.

import type { adminClient } from "@/lib/db/server";
import type { DbUser } from "@/lib/auth/session";

function makeInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface CreateInviteLinkUserParams {
  orgId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: DbUser["role"];
  invitedBy: string;
}

export type CreateInviteLinkUserResult =
  | { ok: true; userId: string; token: string; expiresAt: string }
  | { ok: false; error: string };

/** Insert a pending user (is_active=false) with a 48h invite token — the "send
 *  a link, they set their own password" flow. Does not grant any module. */
export async function createInviteLinkUser(
  admin: ReturnType<typeof adminClient>,
  params: CreateInviteLinkUserParams,
): Promise<CreateInviteLinkUserResult> {
  const userId = crypto.randomUUID();
  const token = makeInviteToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { error } = await admin.from("users").insert({
    id: userId,
    org_id: params.orgId,
    email: params.email || null,
    name: params.name,
    phone: params.phone || null,
    role: params.role,
    must_change_password: true,
    is_active: false,
    invite_token: token,
    invite_expires_at: expiresAt,
    invited_by: params.invitedBy,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "อีเมลนี้มีในระบบแล้ว" : error.message,
    };
  }

  return { ok: true, userId, token, expiresAt };
}

/** Grant module-admin access (user_modules role='admin', upsert so re-invites
 *  don't dup). Returns an error message on failure, null on success. */
export async function grantModuleAdmin(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  userId: string,
  grantedBy: string,
  moduleName: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from as any)("user_modules").upsert(
    {
      org_id: orgId,
      user_id: userId,
      module_name: moduleName,
      role: "admin",
      is_active: true,
      granted_by: grantedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,user_id,module_name" },
  );
  return error ? error.message : null;
}
