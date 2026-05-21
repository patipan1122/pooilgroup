import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

// `oldPassword` is required unless the user is forced to change on first
// login (`must_change_password=true`), in which case the temp password set
// by admin acts as the prior credential and the user verified-by-knowing-it
// is the gate. Without re-auth a stolen session cookie would let an attacker
// silently rotate the password and lock the legitimate owner out.
const Schema = z.object({
  password: z.string().min(8),
  oldPassword: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "รหัสผ่านอย่างน้อย 8 ตัว" },
      { status: 400 },
    );
  }

  const admin = adminClient();

  // Require re-auth via current password unless this is the must-change flow.
  const { data: userRow } = await admin
    .from("users")
    .select("must_change_password, email")
    .eq("id", session.user.id)
    .maybeSingle();
  const mustChange = (userRow as { must_change_password?: boolean } | null)
    ?.must_change_password;
  const email = (userRow as { email?: string } | null)?.email;

  if (!mustChange) {
    if (!parsed.data.oldPassword) {
      return NextResponse.json(
        { error: "ต้องระบุรหัสผ่านปัจจุบัน" },
        { status: 400 },
      );
    }
    if (!email) {
      return NextResponse.json(
        { error: "บัญชีนี้ยังไม่ได้ตั้งอีเมล" },
        { status: 400 },
      );
    }
    // Verify via Supabase signInWithPassword (cheap; no session side-effect
    // when using the anon-key client without persistSession).
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: vErr } = await verifier.auth.signInWithPassword({
      email,
      password: parsed.data.oldPassword,
    });
    if (vErr) {
      return NextResponse.json(
        { error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" },
        { status: 401 },
      );
    }
  }

  const { error } = await admin.auth.admin.updateUserById(session.authUserId, {
    password: parsed.data.password,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Clear must_change_password flag if set
  await admin
    .from("users")
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq("id", session.user.id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "user",
    resourceId: session.user.id,
    diff: { new: { password_changed: true } },
  });

  return NextResponse.json({ success: true });
}
