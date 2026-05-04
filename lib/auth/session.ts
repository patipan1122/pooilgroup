// Auth helpers — read user session + linked DB user record
// Strict: throw if not authenticated. Use guards in pages/APIs.

import { redirect } from "next/navigation";
import { serverClient, adminClient } from "../db/server";

export type DbUser = {
  id: string;
  org_id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role:
    | "super_admin"
    | "org_admin"
    | "branch_manager"
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
};

export async function getSession(): Promise<Session | null> {
  const supabase = await serverClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  // Use admin client to fetch user record so RLS doesn't loop
  // (RLS depends on user.org_id but we need to fetch user to know org_id)
  const admin = adminClient();
  const { data: dbUser } = await admin
    .from("users")
    .select(
      "id, org_id, email, name, phone, role, line_user_id, telegram_user_id, telegram_chat_id, is_active",
    )
    .eq("id", authUser.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!dbUser) return null;

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
  if (!allowed.includes(session.user.role)) redirect("/403");
  return session;
}
