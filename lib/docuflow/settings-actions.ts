"use server";

// DocuFlow · ตั้งค่า → ผู้ใช้งาน & สิทธิ์ — แก้ตำแหน่งของพนักงานที่ "มีสิทธิ์อยู่
// แล้ว" ในโปรแกรมนี้ (สมาชิก ↔ แอดมินโปรแกรม). แยกจาก `inviteProgramStaff`
// (lib/auth/program-invite.ts) ซึ่งใช้ "สร้าง" สมาชิกใหม่เท่านั้น — ตัวนี้แก้
// เฉพาะ grant ของ docuflow ที่มีอยู่แล้ว ไม่แตะ role องค์กร/สาขาที่ดูแล เพื่อไม่
// ให้เจอบั๊กคลาสเดียวกับที่เจอใน `/users/[id]/edit`
// (postmortems/users-edit-form-program-grant-tied-to-role-2026-09-30.md —
// "each grant's visibility/editability should be gated on 'does this grant
// make sense for this entity,' not on the value of an unrelated field").
//
// กฎการแต่งตั้ง "แอดมินโปรแกรม" (user_modules.role='admin') สงวนไว้ที่
// super_admin เท่านั้น — กฎเดียวกับ PUT /api/admin/users/[id]/modules
// (CEO 2026-06-15: "การแต่งตั้งแอดมินโปรแกรม สงวนสำหรับผู้ดูแลระบบ (super
// admin) เท่านั้น") ไม่ได้คิดกฎใหม่แยกสำหรับหน้านี้ — ใช้ threshold เดียวกัน
// เพื่อไม่ให้ rule drift ระหว่างสองที่ (feedback memory:
// "same rule copy-pasted into 2 files always drifts"). ลดตำแหน่งกลับเป็น
// สมาชิก เปิดให้แอดมินของโปรแกรมนี้คนไหนก็ทำได้ (สิทธิ์เดียวกับที่
// inviteProgramStaff ใช้อยู่แล้ว).

import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { canManageUser } from "@/lib/auth/role-guards";
import { grantModuleAdmin } from "@/lib/auth/invite";
import { audit } from "@/lib/audit/log";
import type { DbUser } from "@/lib/auth/session";

const MODULE = "docuflow";

export type SetDocuflowRoleResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setDocuflowMemberRole(
  targetUserId: string,
  newRole: "member" | "admin",
): Promise<SetDocuflowRoleResult> {
  const session = await requireSession();

  if (!(await userIsModuleAdmin(session.user, MODULE))) {
    return { ok: false, error: "เฉพาะแอดมินของ DocuFlow เท่านั้นที่แก้ตำแหน่งได้" };
  }

  if (newRole === "admin" && session.user.role !== "super_admin") {
    return {
      ok: false,
      error:
        "การแต่งตั้งแอดมินโปรแกรม สงวนสำหรับผู้ดูแลระบบ (super admin) เท่านั้น",
    };
  }

  const admin = adminClient();
  const orgId = session.user.org_id;

  const { data: target } = await admin
    .from("users")
    .select("id, org_id, name, role, is_active")
    .eq("id", targetUserId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้นี้" };
  if (!canManageUser(session.user.role, target.role as DbUser["role"])) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการผู้ใช้คนนี้" };
  }

  // แก้ได้เฉพาะ grant ที่ "มีอยู่แล้ว" เท่านั้น — การสร้างใหม่ทำผ่าน
  // inviteProgramStaff เสมอ ไม่ใช่หน้าที่ของ action นี้.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin.from as any)("user_modules")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .eq("module_name", MODULE)
    .eq("is_active", true)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "ผู้ใช้นี้ยังไม่มีสิทธิ์ใน DocuFlow — เชิญก่อน" };
  }

  const err = await grantModuleAdmin(
    admin,
    orgId,
    targetUserId,
    session.user.id,
    MODULE,
    newRole,
  );
  if (err) return { ok: false, error: err };

  await audit({
    orgId,
    userId: session.user.id,
    action: "UPDATE_USER_MODULES",
    resourceType: "user",
    resourceId: targetUserId,
    diff: { new: { module: MODULE, moduleRole: newRole } },
  });

  return { ok: true };
}
