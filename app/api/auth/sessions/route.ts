// List the current user's session history.
// Latest first, includes both active and ended sessions.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const admin = adminClient();

  const { data, error } = await admin
    .from("user_sessions")
    .select(
      "id, ip_address, user_agent, device, login_at, last_active_at, logout_at, is_revoked",
    )
    .eq("user_id", session.user.id)
    .order("login_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data ?? [] });
}
