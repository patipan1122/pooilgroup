// Verify LINE id_token from LIFF and sign user into Supabase using existing email/phone link.
// If LINE userId matches a user.line_user_id row → mint a session via service role.
// If not matched, return needs-link signal so the LIFF page asks user to log in via web first.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

const Schema = z.object({
  lineUserId: z.string().min(5).max(60),
  displayName: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูล LINE ไม่ครบ" }, { status: 400 });
  }
  const { lineUserId, displayName } = parsed.data;
  const admin = adminClient();

  const { data: user } = await admin
    .from("users")
    .select("id, org_id, email, name, role, is_active")
    .eq("line_user_id", lineUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (!user) {
    return NextResponse.json(
      { matched: false, needsLink: true, hint: displayName ?? null },
      { status: 200 },
    );
  }

  // Generate magic link via Supabase admin (so the LIFF page can open it once)
  // We hit Supabase REST through the admin client. If the user has no email,
  // skip — branch_manager can fall back to /login from the LIFF.
  if (!user.email) {
    return NextResponse.json({
      matched: true,
      needsLink: false,
      ready: false,
      message: "บัญชีนี้ยังไม่ได้ตั้ง email — ให้ admin ผูก email ก่อน",
    });
  }

  // Use Supabase Auth Admin API to generate a magic link
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        email: user.email,
        // Pin redirect to the same origin the LIFF page is running on
        // (Supabase otherwise uses the dashboard "Site URL" which can drift).
        redirect_to: `${getRequestBaseUrl(req)}/liff/status`,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[line-login] magiclink", res.status, errText);
      return NextResponse.json(
        { error: "สร้างลิงก์ login ไม่ได้" },
        { status: 502 },
      );
    }
    const j = (await res.json()) as { properties?: { action_link?: string } };
    const link = j.properties?.action_link;
    if (!link) {
      return NextResponse.json(
        { error: "ลิงก์ login หาย" },
        { status: 502 },
      );
    }
    await audit({
      orgId: user.org_id,
      userId: user.id,
      action: "LOGIN",
      resourceType: "line_login",
      resourceId: user.id,
      diff: { new: { via: "line_liff" } },
    });
    return NextResponse.json({
      matched: true,
      needsLink: false,
      ready: true,
      magicLink: link,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error("[line-login]", err);
    return NextResponse.json({ error: "ติดต่อ auth ไม่ได้" }, { status: 500 });
  }
}
