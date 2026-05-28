// POST /api/auth/forgot-password
// Public endpoint — kicks off password reset via Supabase email link.
// Always returns success (avoid email enumeration).
//
// Rate-limited: 3 attempts per IP per hour + 5 per email per day

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

const Schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  // Rate limit: per IP and per email
  const ip = getClientIp(req);
  const ipRl = await checkRateLimit({
    bucket: `forgot-password:ip:${ip}`,
    max: 3,
    windowSec: 60 * 60,
  });
  if (ipRl.limited) {
    return NextResponse.json(
      { error: "ลองรีเซ็ตรหัสบ่อยเกินไป รอ 1 ชั่วโมง" },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email ไม่ถูกต้อง" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  const emailRl = await checkRateLimit({
    bucket: `forgot-password:email:${email}`,
    max: 5,
    windowSec: 24 * 60 * 60,
  });
  if (emailRl.limited) {
    // Silent — don't reveal email exists
    return NextResponse.json({ success: true });
  }

  const admin = adminClient();
  const { data: user } = await admin
    .from("users")
    .select("id, org_id, email, is_active")
    .eq("email", email)
    .maybeSingle();

  // Always return success even if user doesn't exist (prevents enumeration)
  if (!user || !user.is_active) {
    return NextResponse.json({ success: true });
  }

  // Send Supabase password reset email
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    return NextResponse.json({ success: true }); // silent fail
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        options: {
          redirectTo: `${getRequestBaseUrl(req)}/forgot-password/reset`,
        },
      }),
    });
    if (!res.ok) {
      console.error("[forgot-password] Supabase recover failed", await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[forgot-password]", err);
  }

  await audit({
    orgId: user.org_id,
    userId: user.id,
    action: "PASSWORD_RESET_REQUESTED",
    resourceType: "user",
    resourceId: user.id,
    diff: { new: { via: "forgot-password" } },
  });

  return NextResponse.json({ success: true });
}
