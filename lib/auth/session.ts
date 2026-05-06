// Auth helpers — read user session + linked DB user record
// Strict: throw if not authenticated. Use guards in pages/APIs.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { serverClient, adminClient } from "../db/server";
import {
  IMPERSONATION_COOKIE,
  decodeImpersonationCookie,
} from "./impersonation";

export type DbUser = {
  id: string;
  org_id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role:
    | "super_admin"
    | "org_admin"
    | "admin"
    | "branch_manager"
    | "area_manager"
    | "staff"
    | "driver"
    | "viewer";
  line_user_id: string | null;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  is_active: boolean;
};

export type Session = {
  authUserId: string;
  email: string | null;
  user: DbUser;
  /** When set, the real super_admin is impersonating user. UI shows return bar. */
  actingAs?: { realUser: DbUser };
};

const USER_COLS =
  "id, org_id, email, name, phone, role, line_user_id, telegram_user_id, telegram_chat_id, is_active";

export async function getSession(): Promise<Session | null> {
  const supabase = await serverClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const admin = adminClient();
  const { data: dbUser } = await admin
    .from("users")
    .select(USER_COLS)
    .eq("id", authUser.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!dbUser) return null;

  // Impersonation override: if real user is super_admin AND has a valid
  // impersonation cookie bound to their id, swap the surface user to target.
  if ((dbUser as DbUser).role === "super_admin") {
    const cookieStore = await cookies();
    const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
    const payload = decodeImpersonationCookie(raw);
    if (payload && payload.adminId === authUser.id) {
      const { data: targetUser } = await admin
        .from("users")
        .select(USER_COLS)
        .eq("id", payload.targetId)
        .eq("org_id", (dbUser as DbUser).org_id)
        .eq("is_active", true)
        .maybeSingle();
      if (targetUser) {
        return {
          authUserId: authUser.id,
          email: authUser.email ?? null,
          user: targetUser as DbUser,
          actingAs: { realUser: dbUser as DbUser },
        };
      }
    }
  }

  return {
    authUserId: authUser.id,
    email: authUser.email ?? null,
    user: dbUser as DbUser,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(
  ...allowed: DbUser["role"][]
): Promise<Session> {
  const session = await requireSession();
  // When impersonating, role check uses target user's role (so super_admin
  // can see exactly what target sees, including 403s for restricted areas).
  if (!allowed.includes(session.user.role)) redirect("/403");
  return session;
}

/**
 * Like requireRole but checks the REAL underlying user role (not the
 * impersonated one). Use for super-admin-only endpoints (impersonate API,
 * audit log access) that must work even while impersonating someone.
 */
export async function requireRealRole(
  ...allowed: DbUser["role"][]
): Promise<Session> {
  const session = await requireSession();
  const realRole = session.actingAs
    ? session.actingAs.realUser.role
    : session.user.role;
  if (!allowed.includes(realRole)) redirect("/403");
  return session;
}
