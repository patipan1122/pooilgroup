"use server";

// User management — PRIVILEGE-ESCALATION-GUARDED
// Per memory [[role-rank-privilege-escalation-guard]]:
//   - requireRole(ADMIN) alone is NOT sufficient
//   - MUST call canAssignRole(actor, newRole) before changing role
//   - MUST call canManageUser(actor, target) before mutating target
// Pool fixed 3 endpoints because admin could otherwise grant SUPER_ADMIN.
// ChairOps risk: ADMIN could elevate someone to ADMIN/CEO and lose control.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { canAssignRole, canManageUser } from "@/lib/chairops/auth/role-guards";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// Lazy admin client — service-role key, server-only
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ไม่ได้ตั้งค่า");
  }
  return createAdminSupabase(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email("รูปแบบอีเมลไม่ถูกต้อง"),
  role: z.enum(ChairopsUserRole),
  displayName: z.string().trim().min(1, "ต้องระบุชื่อ").max(100),
  primaryBranchId: z.string().optional().or(z.literal("")),
  // Auto-generate temp password if not supplied; user resets via /reset-password
  tempPassword: z.string().min(8).max(72).optional(),
});

export async function createUser(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("ADMIN");

  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    displayName: formData.get("displayName"),
    primaryBranchId: formData.get("primaryBranchId") || undefined,
    tempPassword: formData.get("tempPassword") || undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  // GUARD: cannot create user with role >= your own
  if (!canAssignRole(session.user, parsed.data.role)) {
    return {
      ok: false,
      error: `คุณ (${session.user.role}) ไม่สามารถสร้างผู้ใช้สิทธิ์ ${parsed.data.role} ได้`,
    };
  }

  // Dup check
  const existing = await prisma.chairopsUser.findFirst({
    where: { email: parsed.data.email },
  });
  if (existing) return { ok: false, error: `อีเมล ${parsed.data.email} ถูกใช้แล้ว` };

  // Validate branch if maid (per chairops-maid-one-per-branch)
  if (parsed.data.role === "MAID" && !parsed.data.primaryBranchId) {
    return { ok: false, error: "แม่บ้านต้องมีสาขาประจำ" };
  }
  if (parsed.data.primaryBranchId) {
    const branch = await prisma.chairopsBranch.findUnique({
      where: { id: parsed.data.primaryBranchId },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขาที่เลือก" };
  }

  // Create auth user via Supabase admin
  const supabase = adminClient();
  const tempPassword =
    parsed.data.tempPassword ??
    `Ch${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
  });

  if (authError || !authData?.user) {
    return {
      ok: false,
      error: `สร้างบัญชี auth ไม่สำเร็จ: ${authError?.message ?? "unknown"}`,
    };
  }

  // Create Prisma profile
  try {
    const user = await prisma.chairopsUser.create({
      data: {
        authUserId: authData.user.id,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
        primaryBranchId: parsed.data.primaryBranchId || null,
        isActive: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "user.create",
      entity: "User",
      entityId: user.id,
      oldValue: null,
      newValue: {
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        primaryBranchId: user.primaryBranchId,
      },
      metadata: { tempPasswordGenerated: !parsed.data.tempPassword },
    });

    revalidatePath("/chairops/users");
    return { ok: true, data: { id: user.id } };
  } catch (e) {
    // Rollback auth user if Prisma fails
    await supabase.auth.admin.deleteUser(authData.user.id);
    return {
      ok: false,
      error: `บันทึก profile ไม่สำเร็จ: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }
}

const roleSchema = z.object({
  userId: zUUID(),
  newRole: z.enum(ChairopsUserRole),
});

export async function updateUserRole(
  userId: string,
  newRole: ChairopsUserRole
): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = roleSchema.safeParse({ userId, newRole });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findUnique({ where: { id: parsed.data.userId } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // GUARD 1: cannot assign a role at/above your own
  if (!canAssignRole(session.user, parsed.data.newRole)) {
    return {
      ok: false,
      error: `คุณ (${session.user.role}) ไม่สามารถมอบสิทธิ์ ${parsed.data.newRole} ได้`,
    };
  }

  // GUARD 2: cannot manage a user at/above your rank · cannot self-modify
  if (!canManageUser(session.user, target)) {
    return {
      ok: false,
      error:
        session.user.id === target.id
          ? "ห้ามแก้สิทธิ์ตัวเอง"
          : `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}`,
    };
  }

  if (target.role === parsed.data.newRole) {
    return { ok: false, error: "สิทธิ์เดิมอยู่แล้ว" };
  }

  const updated = await prisma.chairopsUser.update({
    where: { id: target.id },
    data: { role: parsed.data.newRole },
  });

  await writeAudit({
    userId: session.user.id,
    action: "user.update_role",
    entity: "User",
    entityId: updated.id,
    oldValue: { role: target.role },
    newValue: { role: updated.role },
    metadata: { targetEmail: target.email },
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}

const branchSchema = z.object({
  userId: zUUID(),
  branchId: z.string().nullable(),
});

export async function assignBranch(
  userId: string,
  branchId: string | null
): Promise<ActionResult> {
  const session = await requireRole("MANAGER");

  const parsed = branchSchema.safeParse({ userId, branchId });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findUnique({ where: { id: parsed.data.userId } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // GUARD: cannot manage users above your rank
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }

  if (parsed.data.branchId) {
    const branch = await prisma.chairopsBranch.findUnique({
      where: { id: parsed.data.branchId },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขา" };
  }

  const updated = await prisma.chairopsUser.update({
    where: { id: target.id },
    data: { primaryBranchId: parsed.data.branchId },
  });

  await writeAudit({
    userId: session.user.id,
    action: "user.assign_branch",
    entity: "User",
    entityId: updated.id,
    oldValue: { primaryBranchId: target.primaryBranchId },
    newValue: { primaryBranchId: updated.primaryBranchId },
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}

const displayNameSchema = z.object({
  userId: zUUID(),
  displayName: z.string().trim().min(1).max(100),
});

export async function updateDisplayName(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("MANAGER");

  const parsed = displayNameSchema.safeParse({
    userId: formData.get("userId"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findUnique({ where: { id: parsed.data.userId } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // self-edit allowed for displayName; otherwise rank check
  if (session.user.id !== target.id && !canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }

  const updated = await prisma.chairopsUser.update({
    where: { id: target.id },
    data: { displayName: parsed.data.displayName },
  });

  await writeAudit({
    userId: session.user.id,
    action: "user.update_display_name",
    entity: "User",
    entityId: updated.id,
    oldValue: { displayName: target.displayName },
    newValue: { displayName: updated.displayName },
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}

export async function deactivateUser(userId: string): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = zUUID().safeParse(userId);
  if (!parsed.success) return { ok: false, error: "userId ไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findUnique({ where: { id: parsed.data } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // GUARD: cannot deactivate yourself or higher-rank users
  if (!canManageUser(session.user, target)) {
    return {
      ok: false,
      error:
        session.user.id === target.id
          ? "ห้ามปิดบัญชีตัวเอง"
          : `คุณไม่มีสิทธิ์ปิดบัญชีผู้ใช้ระดับ ${target.role}`,
    };
  }

  if (!target.isActive) return { ok: false, error: "ปิดบัญชีไปแล้ว" };

  const updated = await prisma.chairopsUser.update({
    where: { id: target.id },
    data: { isActive: false },
  });

  await writeAudit({
    userId: session.user.id,
    action: "user.deactivate",
    entity: "User",
    entityId: updated.id,
    oldValue: { isActive: true },
    newValue: { isActive: false },
    metadata: { targetEmail: target.email },
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = zUUID().safeParse(userId);
  if (!parsed.success) return { ok: false, error: "userId ไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findUnique({ where: { id: parsed.data } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // Same guard as deactivate (use original target rank — currently inactive)
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์เปิดบัญชีผู้ใช้ระดับ ${target.role}` };
  }

  if (target.isActive) return { ok: false, error: "บัญชีเปิดอยู่แล้ว" };

  const updated = await prisma.chairopsUser.update({
    where: { id: target.id },
    data: { isActive: true },
  });

  await writeAudit({
    userId: session.user.id,
    action: "user.reactivate",
    entity: "User",
    entityId: updated.id,
    oldValue: { isActive: false },
    newValue: { isActive: true },
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}
