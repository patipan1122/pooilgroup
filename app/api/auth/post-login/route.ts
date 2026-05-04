// Record a successful login + create user_sessions row + audit LOGIN.
// Called from login-form.tsx after Supabase signIn succeeds.
// Also called from invite-accept and signup auto-login flows.

import { NextResponse, type NextRequest } from "next/server";
import { recordSuccessfulLogin, getMetaFromRequest } from "@/lib/auth/login-tracker";
import { serverClient } from "@/lib/db/server";

export async function POST(req: NextRequest) {
  // Read auth from cookies (Supabase session must already be set)
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No active session" }, { status: 401 });
  }

  const result = await recordSuccessfulLogin(user.id, getMetaFromRequest(req));
  if (!result) {
    // User exists in auth but not in public.users — onboarding incomplete
    return NextResponse.json(
      { error: "Account onboarding incomplete" },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, sessionId: result.sessionId });
}
