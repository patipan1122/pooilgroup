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
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { canAssignRole, canManageUser } from "@/lib/chairops/auth/role-guards";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { ChairopsUserRole, OffboardingReason } from "@/lib/generated/prisma/enums";
import { randomUUID } from "node:crypto";
import { signInvite, hasInviteSecret } from "@/lib/chairops/line/invite";
import { blockLineUser } from "@/lib/chairops/line/block";

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

  // Dup check (within same org · email is per-org unique)
  const existing = await prisma.chairopsUser.findFirst({
    where: { orgId: session.user.orgId, email: parsed.data.email },
  });
  if (existing) return { ok: false, error: `อีเมล ${parsed.data.email} ถูกใช้แล้ว` };

  // Validate branch if maid (per chairops-maid-one-per-branch)
  if (parsed.data.role === "MAID" && !parsed.data.primaryBranchId) {
    return { ok: false, error: "แม่บ้านต้องมีสาขาประจำ" };
  }
  if (parsed.data.primaryBranchId) {
    const branch = await prisma.chairopsBranch.findFirst({
      where: { id: parsed.data.primaryBranchId, orgId: session.user.orgId },
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

  // Create Prisma profile — Wave-0 fix: profile + audit atomic
  // BF1 fix · for new MAID users with a primary branch, also insert into
  // ChairopsMaidAssignment so the audit-trail table stays in sync.
  try {
    const user = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsUser.create({
        data: {
          orgId: session.user.orgId,
          authUserId: authData.user.id,
          email: parsed.data.email,
          displayName: parsed.data.displayName,
          role: parsed.data.role,
          primaryBranchId: parsed.data.primaryBranchId || null,
          isActive: true,
        },
      });

      if (
        row.role === ChairopsUserRole.MAID &&
        row.primaryBranchId
      ) {
        await tx.chairopsMaidAssignment.create({
          data: {
            orgId: session.user.orgId,
            userId: row.id,
            branchId: row.primaryBranchId,
            startedAt: new Date(),
            isActive: true,
          },
        });
      }

      await writeAudit(
        {
          userId: session.user.id,
          action: "user.create",
          entity: "User",
          entityId: row.id,
          oldValue: null,
          newValue: {
            email: row.email,
            role: row.role,
            displayName: row.displayName,
            primaryBranchId: row.primaryBranchId,
          },
          metadata: { tempPasswordGenerated: !parsed.data.tempPassword },
        },
        tx,
      );

      return row;
    });

    revalidatePath("/chairops/users");
    revalidatePath("/chairops/maids");
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

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.userId, orgId: session.user.orgId },
  });
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

  // Wave-0 fix: role update + audit atomic
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsUser.update({
      where: { id: target.id },
      data: { role: parsed.data.newRole },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "user.update_role",
        entity: "User",
        entityId: row.id,
        oldValue: { role: target.role },
        newValue: { role: row.role },
        metadata: { targetEmail: target.email },
      },
      tx,
    );

    return row;
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

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.userId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // GUARD: cannot manage users above your rank
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }

  if (parsed.data.branchId) {
    const branch = await prisma.chairopsBranch.findFirst({
      where: { id: parsed.data.branchId, orgId: session.user.orgId },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขา" };
  }

  // Wave-0 fix: branch assign + audit atomic.
  // BF1 fix · also wire ChairopsMaidAssignment for maids — close prior
  // open assignment(s), open a new one for the new branch. P2002 from the
  // partial unique index (1 open per maid) is surfaced as a friendly error.
  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (target.role === ChairopsUserRole.MAID) {
        await tx.chairopsMaidAssignment.updateMany({
          where: { userId: target.id, isActive: true, endedAt: null },
          data: { isActive: false, endedAt: new Date() },
        });
        if (parsed.data.branchId) {
          await tx.chairopsMaidAssignment.create({
            data: {
              orgId: session.user.orgId,
              userId: target.id,
              branchId: parsed.data.branchId,
              startedAt: new Date(),
              isActive: true,
            },
          });
        }
      }
      const row = await tx.chairopsUser.update({
        where: { id: target.id },
        data: { primaryBranchId: parsed.data.branchId },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "user.assign_branch",
          entity: "User",
          entityId: row.id,
          oldValue: { primaryBranchId: target.primaryBranchId },
          newValue: { primaryBranchId: row.primaryBranchId },
        },
        tx,
      );
      return row;
    });

    revalidatePath(`/chairops/users/${updated.id}`);
    revalidatePath(`/chairops/maids/${updated.id}`);
    revalidatePath("/chairops/users");
    revalidatePath("/chairops/maids");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "มี assignment ค้างอยู่ · refresh แล้วลองใหม่" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
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

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.userId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // self-edit allowed for displayName; otherwise rank check
  if (session.user.id !== target.id && !canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }

  // Wave-0 fix: display-name update + audit atomic
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsUser.update({
      where: { id: target.id },
      data: { displayName: parsed.data.displayName },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "user.update_display_name",
        entity: "User",
        entityId: row.id,
        oldValue: { displayName: target.displayName },
        newValue: { displayName: row.displayName },
      },
      tx,
    );

    return row;
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}

const deactivateSchema = z.object({
  userId: zUUID(),
  reason: z.enum(OffboardingReason),
  note: z.string().trim().max(500).optional(),
});

export async function deactivateUser(
  userId: string,
  reason: OffboardingReason,
  note?: string,
): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = deactivateSchema.safeParse({ userId, reason, note });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.userId, orgId: session.user.orgId },
  });
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

  // F6: settle gate — block deactivation if maid still has uncollected deposits.
  // Check + deactivate in one transaction (prevents TOCTOU race).
  let lineUserIdForBlock: string | null = null;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      // F6: check pending cash collections (same orgId + maid, depositId=null)
      if (target.role === ChairopsUserRole.MAID) {
        const pendingCount = await tx.chairopsCashCollection.count({
          where: { orgId: target.orgId, maidId: target.id, depositId: null },
        });
        if (pendingCount > 0) {
          throw Object.assign(new Error("SETTLE_REQUIRED"), { pendingCount });
        }
      }

      const row = await tx.chairopsUser.update({
        where: { id: target.id },
        data: {
          isActive: false,
          // F7: deactivation reason + audit trail
          deactivatedAt: new Date(),
          deactivatedById: session.user.id,
          offboardingReason: parsed.data.reason,
          offboardingNote: parsed.data.note ?? null,
          // Clear any pending invite token so the link can't be reused
          inviteToken: null,
          inviteExpiresAt: null,
        },
      });

      await writeAudit(
        {
          userId: session.user.id,
          action: "user.deactivate",
          entity: "User",
          entityId: row.id,
          oldValue: { isActive: true },
          newValue: {
            isActive: false,
            offboardingReason: parsed.data.reason,
            offboardingNote: parsed.data.note ?? null,
          },
          metadata: { targetEmail: target.email },
        },
        tx,
      );

      return row;
    });

    lineUserIdForBlock = updated.lineUserId ?? null;

    revalidatePath(`/chairops/users/${updated.id}`);
    revalidatePath("/chairops/users");
  } catch (e) {
    if (e instanceof Error && e.message === "SETTLE_REQUIRED") {
      const pending = (e as Error & { pendingCount?: number }).pendingCount ?? 0;
      return {
        ok: false,
        error: `ยังมียอดเก็บเงินค้างอยู่ ${pending} รายการ · กรุณาฝากเงินก่อนไล่ออก`,
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }

  // F8: LINE block — best-effort, after transaction (never fails the action).
  // Wrap in try/catch: fetch() can throw on network error (ECONNREFUSED/timeout) which
  // would otherwise poison the return value even though the deactivation already committed.
  if (lineUserIdForBlock) {
    try {
      const blockResult = await blockLineUser(lineUserIdForBlock);
      if (!blockResult.ok) {
        // Write audit entry so admin can see the failure in the audit trail,
        // not just in server logs that may not be queryable from the app.
        await writeAudit({
          userId: session.user.id,
          action: "user.line_block_failed",
          entity: "User",
          entityId: target.id,
          metadata: { lineUserId: lineUserIdForBlock, error: blockResult.error ?? "unknown" },
        });
        console.error("[chairops] LINE block failed after deactivate:", blockResult.error);
      }
    } catch (err) {
      // Network-level error — deactivation already committed, log and move on
      console.error("[chairops] LINE block threw unexpectedly:", err);
    }
  }

  return { ok: true };
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = zUUID().safeParse(userId);
  if (!parsed.success) return { ok: false, error: "userId ไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };

  // Same guard as deactivate (use original target rank — currently inactive)
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์เปิดบัญชีผู้ใช้ระดับ ${target.role}` };
  }

  if (target.isActive) return { ok: false, error: "บัญชีเปิดอยู่แล้ว" };

  // Wave-0 fix: reactivate + audit atomic
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsUser.update({
      where: { id: target.id },
      data: { isActive: true },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "user.reactivate",
        entity: "User",
        entityId: row.id,
        oldValue: { isActive: false },
        newValue: { isActive: true },
      },
      tx,
    );

    return row;
  });

  revalidatePath(`/chairops/users/${updated.id}`);
  revalidatePath("/chairops/users");
  return { ok: true };
}

// Bind a verified LINE userId to a ChairOps user so they can auto-login via the
// LIFF Mini App (see /api/auth/line-login ChairopsUser fallback). ADMIN-only
// (SEC D-CO-M7: never let the client self-claim a LINE identity). Pass empty
// string to UNBIND. The LINE id is the maid's verified `sub` — they read it off
// the "บัญชียังไม่เปิดใช้งาน" screen and give it to the office.
const lineBindSchema = z.object({
  userId: zUUID(),
  lineUserId: z
    .string()
    .trim()
    .regex(/^U[0-9a-f]{32}$/i, "LINE ID ต้องขึ้นต้นด้วย U ตามด้วย 32 ตัวอักษร")
    .or(z.literal("")),
});

export async function bindLineUserId(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = lineBindSchema.safeParse({
    userId: formData.get("userId"),
    lineUserId: formData.get("lineUserId"),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.userId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }

  const nextLineId = parsed.data.lineUserId === "" ? null : parsed.data.lineUserId;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsUser.update({
        where: { id: target.id },
        data: { lineUserId: nextLineId },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: nextLineId ? "user.bind_line" : "user.unbind_line",
          entity: "User",
          entityId: row.id,
          oldValue: { lineUserId: target.lineUserId },
          newValue: { lineUserId: row.lineUserId },
          metadata: { targetEmail: target.email },
        },
        tx,
      );
      return row;
    });
    revalidatePath(`/chairops/users/${updated.id}`);
    revalidatePath("/chairops/users");
    return { ok: true };
  } catch (e) {
    // @@unique([orgId, lineUserId]) — this LINE id already bound elsewhere.
    const isUniq =
      typeof e === "object" && e !== null && "code" in e &&
      (e as { code: unknown }).code === "P2002";
    if (isUniq) return { ok: false, error: "LINE ID นี้ถูกผูกกับผู้ใช้อื่นแล้ว" };
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

// One-tap maid onboarding: create a MAID (name + branch · auto-email, no real
// email needed — login rides LINE id_token) and return a signed invite link.
// The maid taps the link → LINE login → /api/auth/line-login `invite` path
// binds their verified LINE id to this user + logs them in. ADMIN-only.
const inviteSchema = z.object({
  displayName: z.string().trim().min(1, "ต้องระบุชื่อ").max(100),
  primaryBranchId: z.string().min(1, "ต้องเลือกสาขา"),
});

export async function createMaidInvite(
  formData: FormData,
): Promise<ActionResult<{ link: string; userId: string }>> {
  const session = await requireRole("ADMIN");
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) return { ok: false, error: "ยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID)" };

  // Pre-flight: ตรวจกุญแจเซ็นลิงก์ก่อนแตะ Supabase auth — ป้องกัน orphan auth user
  // (เดิม signInvite() throw หลัง createUser แล้ว → ทิ้งบัญชี maid-*@chairops.local ค้าง
  // ทุกครั้งที่กุญแจหาย + เด้งหน้าแดงแทน toast). See [[rule-j-namespace-env-by-program-d021]].
  if (!hasInviteSecret()) {
    return {
      ok: false,
      error: "ระบบยังไม่ได้ตั้งค่ากุญแจลิงก์เชิญ (CHAIROPS_INVITE_SECRET) — แจ้งผู้ดูแลระบบ",
    };
  }

  const parsed = inviteSchema.safeParse({
    displayName: formData.get("displayName"),
    primaryBranchId: formData.get("primaryBranchId"),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  if (!canAssignRole(session.user, ChairopsUserRole.MAID)) {
    return { ok: false, error: "คุณไม่มีสิทธิ์สร้างแม่บ้าน" };
  }

  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: parsed.data.primaryBranchId, orgId: session.user.orgId },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาที่เลือก" };

  // Placeholder email — maids never check it; the magic-link is consumed via
  // httpOnly cookie nav, not delivered. Must be a valid format for Supabase.
  const email = `maid-${randomUUID().slice(0, 8)}@chairops.local`;
  const supabase = adminClient();
  const tempPassword = `Ch${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !authData?.user) {
    return { ok: false, error: `สร้างบัญชี auth ไม่สำเร็จ: ${authError?.message ?? "unknown"}` };
  }

  // F5: generate token BEFORE transaction so we can store it atomically
  const token = signInvite(authData.user.id);
  const inviteExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    const user = await prisma.$transaction(async (tx) => {
      // F5: auto-revoke any existing pending invite for the same branch
      await tx.chairopsUser.updateMany({
        where: {
          orgId: session.user.orgId,
          primaryBranchId: parsed.data.primaryBranchId,
          role: ChairopsUserRole.MAID,
          inviteToken: { not: null },
        },
        data: { inviteToken: null, inviteExpiresAt: null },
      });

      const row = await tx.chairopsUser.create({
        data: {
          orgId: session.user.orgId,
          authUserId: authData.user.id,
          email,
          displayName: parsed.data.displayName,
          role: ChairopsUserRole.MAID,
          primaryBranchId: parsed.data.primaryBranchId,
          isActive: true,
          // F5: store token in DB for revocation
          inviteToken: token,
          inviteExpiresAt,
        },
      });
      // BF1 · wire ghost MaidAssignment table for audit trail.
      await tx.chairopsMaidAssignment.create({
        data: {
          orgId: session.user.orgId,
          userId: row.id,
          branchId: parsed.data.primaryBranchId,
          startedAt: new Date(),
          isActive: true,
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "user.create_invite",
          entity: "User",
          entityId: row.id,
          newValue: {
            displayName: row.displayName,
            role: "MAID",
            primaryBranchId: row.primaryBranchId,
            via: "line_invite",
          },
        },
        tx,
      );
      return row;
    });

    // Keep the link INSIDE the LINE in-app browser (NO openExternalBrowser).
    // openExternalBrowser=1 forced Android to open the link in external Chrome,
    // where LIFF isn't logged in → liff.init failed → OAuth fallback that dropped
    // the invite → maid bounced to /login (2026-06-16). The iOS WKWebView
    // httpOnly-cookie drop it originally worked around is now handled server-side:
    // /auth/liff-complete posts tokens to /api/auth/set-session which writes the
    // session via Set-Cookie (WKWebView-safe). The OAuth fallback also now carries
    // the invite. See memory chairops-invite-link-liff-endpoint-url-2026-06-16.
    const link =
      `https://liff.line.me/${liffId}/chairops` +
      `?invite=${encodeURIComponent(token)}` +
      `&next=${encodeURIComponent("/chairops/m")}`;

    revalidatePath("/chairops/users");
    revalidatePath("/chairops/maids");
    return { ok: true, data: { link, userId: user.id } };
  } catch (e) {
    // Roll back the auth user if the profile write fails.
    await supabase.auth.admin.deleteUser(authData.user.id);
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

// Generalized one-tap invite — like createMaidInvite() but for ANY role
// (office / manager / admin / technician / CEO), so an admin can onboard a
// back-office teammate by link the exact same way maids are onboarded. The
// invitee taps the link → LINE login → /api/auth/line-login `invite` path binds
// their verified LINE id to this user + logs them in. ADMIN-only.
//   - MAID:     requires a branch · lands on /chairops/m · must fill onboarding
//   - non-MAID: branch optional · lands on /chairops · skips the maid-only
//     onboarding form (onboardingComplete=true so line-login won't bounce them
//     to /chairops/m/onboarding, which is gated requireExactRole("MAID")).
const inviteUserSchema = z.object({
  displayName: z.string().trim().min(1, "ต้องระบุชื่อ").max(100),
  role: z.enum(ChairopsUserRole),
  primaryBranchId: z.string().optional().or(z.literal("")),
});

export async function createUserInvite(
  formData: FormData,
): Promise<ActionResult<{ link: string; userId: string }>> {
  const session = await requireRole("ADMIN");
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) return { ok: false, error: "ยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID)" };

  // Pre-flight: ตรวจกุญแจเซ็นลิงก์ก่อนแตะ Supabase auth — กัน orphan auth user
  // (เหมือน createMaidInvite · ดู [[chairops-invite-secret-missing-2026-06-15]]).
  if (!hasInviteSecret()) {
    return {
      ok: false,
      error: "ระบบยังไม่ได้ตั้งค่ากุญแจลิงก์เชิญ (CHAIROPS_INVITE_SECRET) — แจ้งผู้ดูแลระบบ",
    };
  }

  const parsed = inviteUserSchema.safeParse({
    displayName: formData.get("displayName"),
    role: formData.get("role"),
    primaryBranchId: formData.get("primaryBranchId") || undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const role = parsed.data.role;
  const isMaid = role === ChairopsUserRole.MAID;

  // GUARD: ห้ามเชิญผู้ใช้ที่สิทธิ์ >= ตัวเอง (กัน privilege escalation · server re-check)
  if (!canAssignRole(session.user, role)) {
    return {
      ok: false,
      error: `คุณ (${session.user.role}) ไม่สามารถเชิญผู้ใช้สิทธิ์ ${role} ได้`,
    };
  }

  // Branch บังคับเฉพาะแม่บ้าน (1 แม่บ้าน : 1 สาขา) · ตำแหน่งอื่นไม่บังคับ
  const branchId = parsed.data.primaryBranchId || null;
  if (isMaid && !branchId) {
    return { ok: false, error: "แม่บ้านต้องมีสาขาประจำ" };
  }
  if (branchId) {
    const branch = await prisma.chairopsBranch.findFirst({
      where: { id: branchId, orgId: session.user.orgId },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขาที่เลือก" };
  }

  // Placeholder email — invitee ไม่เคยเช็ค; login ใช้ LINE id_token. ต้องเป็น
  // format อีเมลที่ถูกต้องสำหรับ Supabase. (ไม่มีโค้ดไหน parse prefix นี้.)
  const email = `invite-${randomUUID().slice(0, 8)}@chairops.local`;
  const supabase = adminClient();
  const tempPassword = `Ch${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !authData?.user) {
    return { ok: false, error: `สร้างบัญชี auth ไม่สำเร็จ: ${authError?.message ?? "unknown"}` };
  }

  // generate token BEFORE transaction so we can store it atomically
  const token = signInvite(authData.user.id);
  const inviteExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    const user = await prisma.$transaction(async (tx) => {
      // auto-revoke pending same-branch maid invite (mirror createMaidInvite)
      if (isMaid && branchId) {
        await tx.chairopsUser.updateMany({
          where: {
            orgId: session.user.orgId,
            primaryBranchId: branchId,
            role: ChairopsUserRole.MAID,
            inviteToken: { not: null },
          },
          data: { inviteToken: null, inviteExpiresAt: null },
        });
      }

      const row = await tx.chairopsUser.create({
        data: {
          orgId: session.user.orgId,
          authUserId: authData.user.id,
          email,
          displayName: parsed.data.displayName,
          role,
          primaryBranchId: branchId,
          isActive: true,
          // non-maids ข้ามฟอร์มกรอกข้อมูลแม่บ้าน → mark complete กัน line-login
          // เด้งไป /chairops/m/onboarding (ซึ่ง gate requireExactRole("MAID")).
          onboardingComplete: !isMaid,
          inviteToken: token,
          inviteExpiresAt,
        },
      });

      // เฉพาะแม่บ้าน — wire ghost MaidAssignment table สำหรับ audit trail
      if (isMaid && branchId) {
        await tx.chairopsMaidAssignment.create({
          data: {
            orgId: session.user.orgId,
            userId: row.id,
            branchId,
            startedAt: new Date(),
            isActive: true,
          },
        });
      }

      await writeAudit(
        {
          userId: session.user.id,
          action: "user.create_invite",
          entity: "User",
          entityId: row.id,
          newValue: {
            displayName: row.displayName,
            role,
            primaryBranchId: row.primaryBranchId,
            via: "line_invite",
          },
        },
        tx,
      );
      return row;
    });

    // non-maids → หน้าออฟฟิศ /chairops · maids → mini-app /chairops/m
    const next = isMaid ? "/chairops/m" : "/chairops";
    // อยู่ในเบราว์เซอร์ของ LINE (ไม่มี openExternalBrowser) — Android เปิด Chrome
    // ภายนอกที่ LIFF ไม่ได้ล็อกอิน → liff.init fail → OAuth fallback ทำ invite หล่น
    // → เด้ง /login. iOS cookie จัดการฝั่ง server (set-session Set-Cookie) แล้ว ·
    // OAuth fallback ส่ง invite ต่อแล้ว. ดู memory chairops-invite-link-liff-endpoint-url-2026-06-16.
    const link =
      `https://liff.line.me/${liffId}/chairops` +
      `?invite=${encodeURIComponent(token)}` +
      `&next=${encodeURIComponent(next)}`;

    revalidatePath("/chairops/users");
    revalidatePath("/chairops/maids");
    return { ok: true, data: { link, userId: user.id } };
  } catch (e) {
    // Roll back the auth user if the profile write fails.
    await supabase.auth.admin.deleteUser(authData.user.id);
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

// F4: Maid self-onboarding — maid fills 5 fields on first login.
// Called from /chairops/m/onboarding (outside maid layout gate).
// Gate: onboardingComplete must be false (skip if already done).
const onboardingSchema = z.object({
  displayName: z.string().trim().min(1, "ต้องระบุชื่อ").max(100),
  mobilePhone: z.string().trim().min(9, "เบอร์ไม่ถูกต้อง").max(20),
  emergencyContact: z.string().trim().min(1, "ต้องระบุผู้ติดต่อฉุกเฉิน").max(100),
  emergencyPhone: z.string().trim().min(9, "เบอร์ไม่ถูกต้อง").max(20),
  currentMainEmployer: z.string().trim().min(1, "ต้องระบุ").max(200),
});

export async function submitOnboarding(formData: FormData): Promise<ActionResult> {
  const session = await requireExactRole("MAID");

  if (session.user.onboardingComplete) {
    return { ok: false, error: "กรอกข้อมูลไปแล้ว" };
  }

  const parsed = onboardingSchema.safeParse({
    displayName: formData.get("displayName"),
    mobilePhone: formData.get("mobilePhone"),
    emergencyContact: formData.get("emergencyContact"),
    emergencyPhone: formData.get("emergencyPhone"),
    currentMainEmployer: formData.get("currentMainEmployer"),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsUser.update({
      where: { id: session.user.id },
      data: {
        displayName: parsed.data.displayName,
        mobilePhone: parsed.data.mobilePhone,
        emergencyContact: parsed.data.emergencyContact,
        emergencyPhone: parsed.data.emergencyPhone,
        currentMainEmployer: parsed.data.currentMainEmployer,
        onboardingComplete: true,
        // Clear invite token after successful onboarding
        inviteToken: null,
        inviteExpiresAt: null,
      },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "user.onboarding_complete",
        entity: "User",
        entityId: session.user.id,
        newValue: { onboardingComplete: true },
      },
      tx,
    );
  });

  revalidatePath("/chairops/m");
  revalidatePath("/chairops/m/onboarding");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Profile edit — maid แก้ข้อมูลส่วนตัวหลัง onboard
// ---------------------------------------------------------------------------

const profileUpdateSchema = z.object({
  displayName: z.string().min(2, "ชื่ออย่างน้อย 2 ตัวอักษร").max(80),
  mobilePhone: z.string().min(9, "เบอร์มือถือไม่ถูกต้อง").max(20).regex(/^[0-9+\-() ]+$/, "เบอร์มือถือไม่ถูกต้อง"),
  emergencyContact: z.string().min(2, "ระบุชื่อผู้ติดต่อ").max(80),
  emergencyPhone: z.string().min(9, "เบอร์ฉุกเฉินไม่ถูกต้อง").max(20).regex(/^[0-9+\-() ]+$/, "เบอร์ไม่ถูกต้อง"),
  currentMainEmployer: z.string().max(100).optional(),
});

export async function updateMaidProfile(formData: FormData): Promise<ActionResult> {
  const session = await requireExactRole("MAID");

  const parsed = profileUpdateSchema.safeParse({
    displayName: formData.get("displayName"),
    mobilePhone: formData.get("mobilePhone"),
    emergencyContact: formData.get("emergencyContact"),
    emergencyPhone: formData.get("emergencyPhone"),
    currentMainEmployer: formData.get("currentMainEmployer") ?? undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsUser.update({
      where: { id: session.user.id },
      data: {
        displayName: parsed.data.displayName,
        mobilePhone: parsed.data.mobilePhone,
        emergencyContact: parsed.data.emergencyContact,
        emergencyPhone: parsed.data.emergencyPhone,
        currentMainEmployer: parsed.data.currentMainEmployer ?? null,
      },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "user.profile_update",
        entity: "User",
        entityId: session.user.id,
        newValue: { fields: ["displayName", "mobilePhone", "emergencyContact"] },
      },
      tx,
    );
  });

  revalidatePath("/chairops/m/profile");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// S1 Cover ชั่วคราว — admin กำหนด/ล้าง secondary branch ของแม่บ้าน
// ---------------------------------------------------------------------------

export async function assignSecondaryBranch(
  maidId: string,
  branchId: string | null,
): Promise<ActionResult> {
  const session = await requireRole("MANAGER");

  const target = await prisma.chairopsUser.findUnique({
    where: { id: maidId, orgId: session.user.orgId },
    select: { id: true, role: true, displayName: true },
  });
  if (!target) return { ok: false, error: "ไม่พบแม่บ้านรายนี้" };
  if (!canManageUser(session.user, target as Parameters<typeof canManageUser>[1]))
    return { ok: false, error: "ไม่มีสิทธิ์แก้ไขบัญชีนี้" };

  if (branchId) {
    const branch = await prisma.chairopsBranch.findUnique({
      where: { id: branchId, orgId: session.user.orgId },
      select: { id: true },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขานี้" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsUser.update({
      where: { id: maidId },
      data: { secondaryBranchId: branchId },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: branchId ? "user.secondary_branch_assign" : "user.secondary_branch_clear",
        entity: "User",
        entityId: maidId,
        newValue: { secondaryBranchId: branchId },
      },
      tx,
    );
  });

  revalidatePath("/chairops/users");
  revalidatePath(`/chairops/users/${maidId}`);
  return { ok: true };
}
