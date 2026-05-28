// Verify LINE id_token from LIFF and sign user into Supabase using existing email/phone link.
// If LINE userId matches a user.line_user_id row → mint a session via service role.
// If not matched, return needs-link signal so the LIFF page asks user to log in via web first.
//
// Security (P0 hardening — was vulnerable to LINE userId spoofing):
//   ❌ ก่อนหน้านี้: รับ lineUserId จาก client ตรง ๆ → ใครรู้ LINE ID ก็ login เป็นใครก็ได้
//   ✅ ตอนนี้: รับ idToken (JWT จาก LIFF) → verify ผ่าน LINE Verify API ก่อน

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

const Schema = z.object({
  idToken: z.string().min(20).max(4096),
  displayName: z.string().max(120).optional(),
});

// Verify LINE id_token via official endpoint
// Returns the verified payload { sub, name, ... } or null if invalid
async function verifyLineIdToken(
  idToken: string,
): Promise<{ sub: string; name?: string } | null> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) return null;
  // LIFF ID format: "{channelId}-{liffAppId}" — LINE verify expects channelId
  const channelId = liffId.split("-")[0];
  if (!channelId) return null;
  try {
    const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { sub?: string; name?: string };
    if (!j.sub) return null;
    return { sub: j.sub, name: j.name };
  } catch {
    return null;
  }
}

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
  const { idToken, displayName } = parsed.data;

  // Verify token via LINE — only proceed if signature is valid + sub returned
  const verified = await verifyLineIdToken(idToken);
  if (!verified) {
    return NextResponse.json(
      { error: "LINE token ไม่ถูกต้อง" },
      { status: 401 },
    );
  }
  const lineUserId = verified.sub;
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
    // Don't return the Supabase action_link in the JSON response — anything
    // that can read the response (XSS, browser extension, leaked log) becomes
    // that user. Stash the link in a short-lived httpOnly cookie and have the
    // client navigate to a server route that consumes it via 302.
    const response = NextResponse.json({
      matched: true,
      needsLink: false,
      ready: true,
      completeUrl: "/api/auth/line-complete",
      user: { id: user.id, name: user.name, role: user.role },
    });
    response.cookies.set("ll_pending", link, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/line-complete",
      maxAge: 60, // single-use, expires fast
    });
    return response;
  } catch (err) {
    console.error("[line-login]", err);
    return NextResponse.json({ error: "ติดต่อ auth ไม่ได้" }, { status: 500 });
  }
}
