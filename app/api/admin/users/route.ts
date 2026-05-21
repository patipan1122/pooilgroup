import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";
import { canAssignRole } from "@/lib/auth/role-guards";

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
  branchIds: z.array(zUUID()).optional(),
  // When provided + email also provided → admin sets password directly:
  // creates the auth user immediately, marks must_change_password so the
  // invitee is forced to change it on first login. Skips invite-link flow.
  password: z.string().min(8).max(72).optional().or(z.literal("")),
});

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

  // Privilege-escalation guard: caller can only invite users at a role rank
  // strictly below their own (super_admin can grant peer-level super_admin).
  if (!canAssignRole(session.user.role, data.role)) {
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์เชิญผู้ใช้ระดับนี้" },
      { status: 403 },
    );
  }

  const admin = adminClient();
  const orgId = session.user.org_id;
  const now = new Date().toISOString();
  const directPassword = data.password && data.password.length >= 8 ? data.password : null;

  if (directPassword && !data.email) {
    return NextResponse.json(
      { error: "ตั้งรหัสผ่านต้องระบุอีเมลด้วย" },
      { status: 400 },
    );
  }

  // Branch 1: Direct password — create auth user immediately, account ready to use.
  if (directPassword && data.email) {
    const { data: authData, error: authErr } =
      await admin.auth.admin.createUser({
        email: data.email,
        password: directPassword,
        email_confirm: true,
        user_metadata: { name: data.name },
      });

    if (authErr || !authData.user) {
      const msg = authErr?.message ?? "สร้างบัญชีไม่ได้";
      const isDup = /already|exist|registered/i.test(msg);
      return NextResponse.json(
        { error: isDup ? "อีเมลนี้มีในระบบแล้ว" : msg },
        { status: isDup ? 409 : 500 },
      );
    }

    const userId = authData.user.id;
    const { error: insertErr } = await admin.from("users").insert({
      id: userId,
      org_id: orgId,
      email: data.email,
      name: data.name,
      phone: data.phone || null,
      role: data.role,
      must_change_password: true,
      is_active: true,
      invited_by: session.user.id,
      invite_used_at: now,
      updated_at: now,
    });

    if (insertErr) {
      // Rollback the auth user so we don't leave orphans
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { error: "อีเมลนี้มีในระบบแล้ว" },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

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
      diff: {
        new: {
          name: data.name,
          role: data.role,
          set_password_directly: true,
          must_change_password: true,
        },
      },
    });

    return NextResponse.json({
      success: true,
      mode: "direct_password",
      userId,
      email: data.email,
      // Echo password back ONCE so admin can copy/share — server doesn't store it.
      password: directPassword,
    });
  }

  // Branch 2: Invite-link flow (default).
  const userId = crypto.randomUUID();
  const token = makeToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { error: insertErr } = await admin.from("users").insert({
    id: userId,
    org_id: orgId,
    email: data.email || null,
    name: data.name,
    phone: data.phone || null,
    role: data.role,
    must_change_password: true,
    is_active: false,
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

  const inviteUrl = `${getRequestBaseUrl(req)}/invite/${token}`;

  return NextResponse.json({
    success: true,
    mode: "invite",
    userId,
    inviteUrl,
    expiresAt,
  });
}
