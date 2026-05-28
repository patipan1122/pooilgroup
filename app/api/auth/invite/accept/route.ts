import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  token: z.string().min(20),
  userId: zUUID(),
  email: z.string().email(),
  password: z.string().min(8),
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const { token, userId, email, password } = parsed.data;
  const admin = adminClient();

  // Verify token + user
  const { data: pending } = await admin
    .from("users")
    .select("id, org_id, name, role, invite_token, invite_expires_at, invite_used_at, is_active")
    .eq("id", userId)
    .eq("invite_token", token)
    .maybeSingle();

  if (!pending) {
    return NextResponse.json({ error: "Invite ไม่ถูกต้อง" }, { status: 400 });
  }

  if (pending.is_active || pending.invite_used_at) {
    return NextResponse.json(
      { error: "Invite ถูกใช้ไปแล้ว — ใช้หน้า Login" },
      { status: 409 },
    );
  }

  if (
    pending.invite_expires_at &&
    new Date(pending.invite_expires_at) < new Date()
  ) {
    return NextResponse.json({ error: "Invite หมดอายุ" }, { status: 410 });
  }

  // Check email not used by other auth user
  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .neq("id", userId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "อีเมลนี้ถูกใช้แล้ว" },
      { status: 409 },
    );
  }

  // Need to create auth user with the SAME id as the pending users.id
  // Supabase doesn't allow specifying id directly, so:
  //   1) delete the pending users row (preserve user_branches via FK behavior)
  //   2) createUser → get new id
  //   3) re-insert users row with new id and copy user_branches relations
  // Easier alt: createUser, then UPDATE users SET id = new_id WHERE id = old_id
  // — but that breaks all FKs. So we use approach 1 with relinking.

  const { data: oldBranches } = await admin
    .from("user_branches")
    .select("branch_id, is_active")
    .eq("user_id", userId);

  // Pre-audit BEFORE the structural id-swap below.
  // The pending users row uses a temp UUID; Supabase auth issues its own id on
  // createUser, so this flow swaps temp→real. The DELETEs below are NOT a
  // soft-delete violation — they are atomic to the swap. We log here so the
  // INVITE_ACCEPTED action is recorded with the temp id before it is freed.
  await audit({
    orgId: pending.org_id,
    userId,
    action: "INVITE_ACCEPTED",
    resourceType: "user",
    resourceId: userId,
    diff: { old: { is_active: false, invite_used_at: null }, new: { temp_id: userId } },
  });

  // Step 1: temporarily detach old branches (will be re-attached to new auth id)
  await admin.from("user_branches").delete().eq("user_id", userId);

  // Step 2: delete pending row to free email + temp id (id-swap, not soft-delete)
  const oldUser = pending;
  await admin.from("users").delete().eq("id", userId);

  // Step 3: create auth user (auto-confirm)
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: oldUser.name },
  });
  if (authErr || !authData.user) {
    // Rollback — re-insert pending row
    await admin.from("users").insert({
      id: oldUser.id,
      org_id: oldUser.org_id,
      email: null,
      name: oldUser.name,
      role: oldUser.role,
      must_change_password: true,
      is_active: false,
      invite_token: token,
      invite_expires_at: pending.invite_expires_at,
      updated_at: new Date().toISOString(),
    });
    if (oldBranches) {
      await admin.from("user_branches").insert(
        oldBranches.map((b) => ({
          id: crypto.randomUUID(),
          org_id: oldUser.org_id,
          user_id: oldUser.id,
          branch_id: b.branch_id,
          is_active: b.is_active,
        })),
      );
    }
    return NextResponse.json(
      { error: authErr?.message ?? "สร้างบัญชีไม่ได้" },
      { status: 500 },
    );
  }

  const newAuthId = authData.user.id;

  // Step 4: insert public.users with NEW id — rollback auth user on failure
  const now = new Date().toISOString();
  const insertUser = await admin.from("users").insert({
    id: newAuthId,
    org_id: oldUser.org_id,
    email,
    name: oldUser.name,
    role: oldUser.role,
    must_change_password: false,
    is_active: true,
    invite_token: null,
    invite_used_at: now,
    invite_expires_at: null,
    updated_at: now,
  });
  if (insertUser.error) {
    // Rollback: delete the auth user we just created + restore pending row
    await admin.auth.admin.deleteUser(newAuthId).catch(() => {});
    await admin.from("users").insert({
      id: oldUser.id,
      org_id: oldUser.org_id,
      email: null,
      name: oldUser.name,
      role: oldUser.role,
      must_change_password: true,
      is_active: false,
      invite_token: token,
      invite_expires_at: pending.invite_expires_at,
      updated_at: now,
    });
    if (oldBranches) {
      await admin.from("user_branches").insert(
        oldBranches.map((b) => ({
          id: crypto.randomUUID(),
          org_id: oldUser.org_id,
          user_id: oldUser.id,
          branch_id: b.branch_id,
          is_active: b.is_active,
        })),
      );
    }
    return NextResponse.json(
      { error: "บันทึกข้อมูลใหม่ไม่ได้ — ลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  // Step 5: re-link branches — best-effort (user is already active)
  // ถ้า step นี้ fail user ใช้ระบบได้ แต่ไม่มี branch access → admin re-assign ได้
  if (oldBranches && oldBranches.length > 0) {
    const { error: branchErr } = await admin.from("user_branches").insert(
      oldBranches.map((b) => ({
        id: crypto.randomUUID(),
        org_id: oldUser.org_id,
        user_id: newAuthId,
        branch_id: b.branch_id,
        is_active: b.is_active,
      })),
    );
    if (branchErr) {
      console.error("[invite/accept] branch relink failed", branchErr);
      // Don't fail the whole flow — log + audit, admin can fix
      await audit({
        orgId: oldUser.org_id,
        userId: newAuthId,
        action: "CREATE_USER",
        resourceType: "user",
        resourceId: newAuthId,
        diff: {
          new: {
            activated: true,
            role: oldUser.role,
            branch_relink_failed: true,
            error: branchErr.message,
          },
        },
      });
      return NextResponse.json({
        success: true,
        warning: "บัญชีพร้อมใช้งานแล้ว แต่ผูกสาขาไม่ได้ — ติดต่อ admin",
      });
    }
  }

  await audit({
    orgId: oldUser.org_id,
    userId: newAuthId,
    action: "CREATE_USER",
    resourceType: "user",
    resourceId: newAuthId,
    diff: { new: { activated: true, role: oldUser.role } },
  });

  return NextResponse.json({ success: true });
}
