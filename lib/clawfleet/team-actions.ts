"use server";

// ClawFleet v2 — Team & สาขา mutations (เชิญ / แก้สิทธิ์ / เอาออก / สร้างลิงก์เชิญใหม่).
//
// REUSE:
//  - invite token = crypto hex 48-char + 48h expiry (เหมือน resend-invite route)
//  - invite LINK = <baseUrl>/invite/<token> (หน้า redeem มีอยู่แล้ว app/(auth)/invite/[token])
//  - impersonation ("เข้าใช้แทน") ใช้ POST /api/admin/users/[id]/impersonate ฝั่ง client (ไม่ทำที่นี่)
//  - gate ทุก action ด้วย assertCfAdmin() · audit() ทุกการเปลี่ยนแปลง · revalidatePath
//
// org/branch-scoped: ทุก write ตรวจว่า branch + user อยู่ใน org ของผู้เรียก และ
// (ถ้าไม่ใช่ admin org-wide) อยู่ในสาขาที่ผู้เรียกดูแล.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { getBaseUrl } from "@/lib/utils/base-url";
import { assertCfAdmin, userBranchIds } from "./role-guard";

type Result = { ok: true } | { ok: false; error: string };
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };

const TEAM_PATH = "/clawfleet/v2/team";

/** role ที่อนุญาตให้กำหนดให้พนักงานสาขาตู้คีบ (ไม่เปิด admin org-wide จากหน้านี้) */
const CF_ASSIGNABLE_ROLES = ["staff", "branch_manager", "area_manager"] as const;
type CfAssignableRole = (typeof CF_ASSIGNABLE_ROLES)[number];

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 ชั่วโมง (เท่ากับ resend-invite route)

/** invite token แบบเดียวกับ resend-invite route — 24 ไบต์ → hex 48 ตัว */
function makeInviteToken(): string {
  return randomBytes(24).toString("hex");
}

/** base URL จริงของ request (ให้ลิงก์ตรงโดเมนที่แอดมินกำลังใช้) · fallback env */
async function requestBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${proto}://${host}`;
  return getBaseUrl();
}

/** ตรวจว่าผู้เรียกเข้าถึงสาขานี้ได้ไหม (admin org-wide = ได้ทุกสาขา) */
async function assertBranchInScope(
  session: Awaited<ReturnType<typeof assertCfAdmin>>,
  branchId: string,
): Promise<Result> {
  const orgId = session.user.org_id;
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine", isActive: true },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบในองค์กรนี้" };
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการสาขานี้" };
  }
  return { ok: true };
}

// =============================================================
// เชิญพนักงานใหม่ — สร้าง User (pending) + ผูกสาขา + ลิงก์เชิญ
// =============================================================

const InviteSchema = z.object({
  name: z.string().trim().min(1, "กรอกชื่อพนักงาน").max(100),
  email: z.string().trim().email("อีเมลไม่ถูกต้อง").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  branchId: z.string().min(1, "เลือกสาขา"),
  role: z.enum(CF_ASSIGNABLE_ROLES),
});

export async function inviteCfStaff(
  input: unknown,
): Promise<ResultOf<{ userId: string; inviteUrl: string; name: string }>> {
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { name, branchId, role } = parsed.data;
  const email = parsed.data.email ? parsed.data.email : null;
  const phone = parsed.data.phone ? parsed.data.phone : null;

  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const scope = await assertBranchInScope(session, branchId);
  if (!scope.ok) return scope;

  // กันอีเมลซ้ำในองค์กร (email เป็น unique global ใน schema)
  if (email) {
    const dup = await prisma.user.findFirst({
      where: { email },
      select: { id: true, orgId: true },
    });
    if (dup) {
      return {
        ok: false,
        error:
          dup.orgId === orgId
            ? "อีเมลนี้มีพนักงานอยู่แล้ว · ใช้ปุ่มแก้สิทธิ์เพื่อเพิ่มเข้าสาขา"
            : "อีเมลนี้ถูกใช้ในระบบแล้ว",
      };
    }
  }

  const token = makeInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          orgId,
          name,
          email,
          phone,
          role,
          isActive: false, // pending จนกว่าจะกดลิงก์เชิญ
          mustChangePassword: true,
          invitedBy: session.user.id,
          inviteToken: token,
          inviteExpiresAt: expiresAt,
        },
        select: { id: true },
      });
      await tx.userBranch.create({
        data: { orgId, userId: created.id, branchId, isActive: true },
      });
      return created;
    });

    await audit({
      orgId,
      userId: session.user.id,
      action: "CREATE_USER",
      resourceType: "user",
      resourceId: user.id,
      diff: { new: { name, email, role, branchId, via: "clawfleet_team_invite" } },
    });

    const inviteUrl = `${await requestBaseUrl()}/invite/${token}`;
    revalidatePath(TEAM_PATH);
    return { ok: true, data: { userId: user.id, inviteUrl, name } };
  } catch (e) {
    // P2002 = unique violation (อีเมล/อื่น ๆ)
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "ข้อมูลซ้ำกับพนักงานที่มีอยู่ (อีเมล) · ตรวจอีกครั้ง" };
    }
    return { ok: false, error: `เชิญพนักงานไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// แก้สิทธิ์ — เปลี่ยน role ของ user (ระดับ User.role)
// =============================================================

const UpdateRoleSchema = z.object({ role: z.enum(CF_ASSIGNABLE_ROLES) });

export async function updateCfStaffRole(
  userId: string,
  branchId: string,
  role: CfAssignableRole,
): Promise<Result> {
  const parsed = UpdateRoleSchema.safeParse({ role });
  if (!parsed.success) return { ok: false, error: "บทบาทไม่ถูกต้อง" };

  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const scope = await assertBranchInScope(session, branchId);
  if (!scope.ok) return scope;

  const target = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: { id: true, role: true, name: true },
  });
  if (!target) return { ok: false, error: "ไม่พบพนักงานในองค์กรนี้" };

  // ห้ามลดสิทธิ์ admin-tier จากหน้านี้ (ป้องกันยึดสิทธิ์ผิดพลาด — จัดที่หน้า users กลาง)
  const ADMIN_TIER = ["super_admin", "org_admin", "admin"];
  if (ADMIN_TIER.includes(target.role)) {
    return { ok: false, error: "พนักงานคนนี้เป็นแอดมินองค์กร · เปลี่ยนสิทธิ์ที่หน้าผู้ใช้ส่วนกลาง" };
  }
  if (target.role === parsed.data.role) return { ok: true };

  // ต้องผูกกับสาขานี้จริง
  const ub = await prisma.userBranch.findFirst({
    where: { userId, branchId },
    select: { id: true },
  });
  if (!ub) return { ok: false, error: "พนักงานไม่ได้อยู่ในสาขานี้" };

  try {
    await prisma.user.update({ where: { id: userId }, data: { role: parsed.data.role } });
    await audit({
      orgId,
      userId: session.user.id,
      action: "UPDATE_USER",
      resourceType: "user",
      resourceId: userId,
      diff: { old: { role: target.role }, new: { role: parsed.data.role } },
    });
    revalidatePath(TEAM_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `แก้สิทธิ์ไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// เอาออกจากสาขา — ลบ UserBranch (soft: ถ้าไม่เหลือสาขา → ปิดใช้งาน user)
// =============================================================

export async function removeCfStaff(userId: string, branchId: string): Promise<Result> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const scope = await assertBranchInScope(session, branchId);
  if (!scope.ok) return scope;

  if (userId === session.user.id) {
    return { ok: false, error: "เอาตัวเองออกจากสาขาไม่ได้" };
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: { id: true, name: true, role: true },
  });
  if (!target) return { ok: false, error: "ไม่พบพนักงานในองค์กรนี้" };

  const ub = await prisma.userBranch.findFirst({
    where: { userId, branchId },
    select: { id: true },
  });
  if (!ub) return { ok: false, error: "พนักงานไม่ได้อยู่ในสาขานี้" };

  try {
    let deactivated = false;
    await prisma.$transaction(async (tx) => {
      await tx.userBranch.delete({ where: { id: ub.id } });
      // ถ้าไม่เหลือสาขาเลย → ปิดใช้งาน user (soft) กันบัญชีลอยไม่มีสาขา
      const remaining = await tx.userBranch.count({ where: { userId } });
      if (remaining === 0) {
        await tx.user.update({ where: { id: userId }, data: { isActive: false } });
        deactivated = true;
      }
    });

    await audit({
      orgId,
      userId: session.user.id,
      action: deactivated ? "DEACTIVATE_USER" : "UPDATE_USER",
      resourceType: "user",
      resourceId: userId,
      diff: { old: { branchId }, new: { removedFromBranch: branchId, deactivated } },
    });
    revalidatePath(TEAM_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `เอาออกไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// สร้างลิงก์เชิญใหม่ — re-issue token (สำหรับคนที่ยังไม่เข้าระบบ / ลิงก์หมดอายุ)
// =============================================================

export async function regenInviteLink(
  userId: string,
): Promise<ResultOf<{ inviteUrl: string; name: string }>> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const target = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: {
      id: true,
      name: true,
      inviteUsedAt: true,
      lastLoginAt: true,
      userBranches: { select: { branchId: true } },
    },
  });
  if (!target) return { ok: false, error: "ไม่พบพนักงานในองค์กรนี้" };

  // ต้องดูแลอย่างน้อย 1 สาขาของพนักงานคนนี้ได้
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL") {
    const overlap = target.userBranches.some((ub) => allowed.includes(ub.branchId));
    if (!overlap) return { ok: false, error: "ไม่มีสิทธิ์จัดการพนักงานคนนี้" };
  }

  if (target.inviteUsedAt || target.lastLoginAt) {
    return { ok: false, error: "พนักงานคนนี้เข้าระบบแล้ว · ไม่ต้องใช้ลิงก์เชิญ" };
  }

  const token = makeInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { inviteToken: token, inviteExpiresAt: expiresAt, isActive: false },
    });
    await audit({
      orgId,
      userId: session.user.id,
      action: "UPDATE_USER",
      resourceType: "user",
      resourceId: userId,
      diff: { new: { reissuedInvite: true } },
    });
    const inviteUrl = `${await requestBaseUrl()}/invite/${token}`;
    revalidatePath(TEAM_PATH);
    return { ok: true, data: { inviteUrl, name: target.name } };
  } catch (e) {
    return { ok: false, error: `สร้างลิงก์เชิญใหม่ไม่สำเร็จ: ${(e as Error).message}` };
  }
}
