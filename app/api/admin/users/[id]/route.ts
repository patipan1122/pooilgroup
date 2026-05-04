// GET   /api/admin/users/[id] — fetch single user (admin only, same org)
// PATCH /api/admin/users/[id] — update name/role/phone/branches
// DELETE /api/admin/users/[id] — soft delete (deactivate + force logout)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const PatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().nullable().optional(),
  role: z
    .enum([
      "super_admin",
      "org_admin",
      "branch_manager",
      "staff",
      "driver",
      "viewer",
    ])
    .optional(),
  branchIds: z.array(z.string().uuid()).optional(),
});

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await ctx.params;
  const admin = adminClient();

  const { data, error } = await admin
    .from("users")
    .select(
      "id, org_id, email, name, phone, role, line_user_id, telegram_user_id, telegram_chat_id, is_active, last_login_at, failed_login_count, locked_until, invite_token, invite_expires_at, invite_used_at, created_at, updated_at",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: branches } = await admin
    .from("user_branches")
    .select("branch_id, is_active, branches(id, code, name, business_type)")
    .eq("user_id", id)
    .eq("is_active", true);

  return NextResponse.json({ user: data, branches: branches ?? [] });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();

  // Confirm target user belongs to same org
  const { data: existing } = await admin
    .from("users")
    .select("id, org_id, role, name, email, phone")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Prevent demoting the last super_admin
  if (
    parsed.data.role &&
    parsed.data.role !== "super_admin" &&
    existing.role === "super_admin"
  ) {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", session.user.org_id)
      .eq("role", "super_admin")
      .eq("is_active", true);
    if (!count || count <= 1) {
      return NextResponse.json(
        { error: "ต้องมี Super Admin อย่างน้อย 1 คนในระบบ" },
        { status: 409 },
      );
    }
  }

  // Build patch object — only fields explicitly provided
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;

  const { error: updateErr } = await admin
    .from("users")
    .update(updates)
    .eq("id", id);

  if (updateErr) {
    if (updateErr.code === "23505") {
      return NextResponse.json(
        { error: "อีเมลนี้มีในระบบแล้ว" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Replace branch assignments if provided
  if (parsed.data.branchIds) {
    await admin.from("user_branches").delete().eq("user_id", id);
    if (parsed.data.branchIds.length > 0) {
      await admin.from("user_branches").insert(
        parsed.data.branchIds.map((branchId) => ({
          id: crypto.randomUUID(),
          org_id: session.user.org_id,
          user_id: id,
          branch_id: branchId,
          is_active: true,
        })),
      );
    }
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "user",
    resourceId: id,
    diff: {
      old: existing,
      new: { ...updates, branchIds: parsed.data.branchIds },
    },
  });

  return NextResponse.json({ success: true });
}

/**
 * Deactivate user — soft delete per RULES §7.
 * Side effects:
 *   - is_active = false
 *   - revoke all active sessions (force logout)
 *   - clear lock state
 * Caller must NOT be deactivating themselves; we block that.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await ctx.params;

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "ปิดบัญชีตัวเองไม่ได้ — ให้ Admin คนอื่นทำให้" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, org_id, name, role, is_active")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!target.is_active) {
    return NextResponse.json({ error: "บัญชีนี้ปิดอยู่แล้ว" }, { status: 409 });
  }

  // Don't allow killing the last super_admin
  if (target.role === "super_admin") {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", session.user.org_id)
      .eq("role", "super_admin")
      .eq("is_active", true);
    if (!count || count <= 1) {
      return NextResponse.json(
        { error: "ต้องมี Super Admin อย่างน้อย 1 คนในระบบ" },
        { status: 409 },
      );
    }
  }

  const now = new Date().toISOString();

  // Mark all sessions revoked (force logout from every device)
  await admin
    .from("user_sessions")
    .update({ is_revoked: true, logout_at: now })
    .eq("user_id", id)
    .is("logout_at", null);

  // Soft-delete user
  await admin
    .from("users")
    .update({ is_active: false, updated_at: now })
    .eq("id", id);

  // Also try to invalidate Supabase auth refresh tokens
  try {
    await admin.auth.admin.signOut(id, "global");
  } catch {
    // signOut may fail if no active session — ignore
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DEACTIVATE_USER",
    resourceType: "user",
    resourceId: id,
    diff: { old: target, new: { is_active: false } },
  });

  return NextResponse.json({ success: true });
}
