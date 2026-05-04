// Proper logout: mark session row, audit LOGOUT, then sign out Supabase.
// Frontend should call this BEFORE redirecting to /login.

import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/db/server";
import { recordLogout, getMetaFromRequest } from "@/lib/auth/login-tracker";

export async function POST(req: NextRequest) {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await recordLogout(user.id, null, getMetaFromRequest(req));
    await supabase.auth.signOut();
  }

  return NextResponse.json({ success: true });
}
