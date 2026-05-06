import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

const InviteSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  role: z.enum([
    "super_admin",
    "org_admin",
    "branch_manager",
    "staff",
    "driver",
    "viewer",
  ]),
  branchIds: z.array(z.string().uuid()).optional(),
});

// Generate cryptographically random invite token
function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const admin = adminClient();
  const orgId = session.user.org_id;
  const userId = crypto.randomUUID();
  const token = makeToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  // Insert pending user (no auth user yet — created when they accept invite)
  const { error: insertErr } = await admin.from("users").insert({
    id: userId,
    org_id: orgId,
    email: data.email || null,
    name: data.name,
    phone: data.phone || null,
    role: data.role,
    must_change_password: true,
    is_active: false, // becomes active when invite accepted
    invite_token: token,
    invite_expires_at: expiresAt,
    invited_by: session.user.id,
    updated_at: now,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "อีเมลนี้มีในระบบแล้ว" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Insert user_branches
  if (data.branchIds && data.branchIds.length > 0) {
    const rows = data.branchIds.map((branchId) => ({
      id: crypto.randomUUID(),
      org_id: orgId,
      user_id: userId,
      branch_id: branchId,
      is_active: true,
    }));
    await admin.from("user_branches").insert(rows);
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "CREATE_USER",
    resourceType: "user",
    resourceId: userId,
    diff: { new: { name: data.name, role: data.role, invited: true } },
  });

  // Build invite URL — user copies and sends to invitee
  const inviteUrl = `${getRequestBaseUrl(req)}/invite/${token}`;

  return NextResponse.json({
    success: true,
    userId,
    inviteUrl,
    expiresAt,
  });
}
