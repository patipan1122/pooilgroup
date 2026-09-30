"use server";

// Generic "program admin invites their own team" action — the CEO asked for
// every program to work like Recruit's self-serve invite (CEO 2026-09-30):
// "ถ้าตัวเองเป็นแอดมินโปรแกรมนั้น ก็ควรเชิญคนอื่นเป็นได้ แต่ตำแหน่งต้องต่ำกว่า
// ตัวเองเสมอ" — if you administer a program, you can invite into it, but the
// appointee's rank must always be strictly below your own.
//
// Unlike Recruit's carve-out (which mints a peer program_admin — a deliberate,
// narrow exception CEO approved 2026-09-06), this generic path always mints a
// plain "staff" user with a MEMBER-level grant on the caller's own program —
// never another program_admin/peer — so it can safely apply to every program
// without widening the org-wide "admin appointment = super_admin only" lock
// (CEO 2026-06-15). Rank is enforced via the same canAssignRole() used
// everywhere else in the repo, not a new rule.

import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { canAssignRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { createInviteLinkUser, grantModuleAdmin } from "@/lib/auth/invite";
import { getBaseUrl } from "@/lib/utils/base-url";
import { MODULES, type ModuleSlug } from "@/lib/modules";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteProgramStaffResult =
  | { ok: true; inviteUrl: string; expiresAt: string }
  | { ok: false; error: string };

export async function inviteProgramStaff(input: {
  moduleSlug: string;
  name: string;
  email?: string;
  phone?: string;
}): Promise<InviteProgramStaffResult> {
  const moduleSlug = input.moduleSlug as ModuleSlug;
  if (!(moduleSlug in MODULES)) {
    return { ok: false, error: "ไม่พบโปรแกรมนี้" };
  }
  // ศูนย์ควบคุมต้นทุนสงวนไว้ที่ super_admin เท่านั้นทุกช่องทาง (ล็อกเดิม,
  // app/api/admin/users/[id]/modules/route.ts ก็บล็อกแบบเดียวกัน).
  if (moduleSlug === "costctrl") {
    return { ok: false, error: "ศูนย์ควบคุมต้นทุนสงวนสิทธิ์ไว้ที่ super_admin เท่านั้น" };
  }

  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, moduleSlug))) {
    return { ok: false, error: "เฉพาะแอดมินของโปรแกรมนี้เท่านั้นที่เชิญทีมงานได้" };
  }
  // ตำแหน่งที่เชิญ (staff) ต้องต่ำกว่าตำแหน่งของคนเชิญเสมอ — กันไม่ให้คนที่
  // ตำแหน่งจริงต่ำ (เช่นถูกตั้งเป็นแอดมินเฉพาะโมดูลแบบ hand-pick) เชิญคนที่
  // จริงๆ แล้วอยู่ระดับเดียวกับตัวเอง
  if (!canAssignRole(session.user.role, "staff")) {
    return { ok: false, error: "ตำแหน่งของคุณไม่สามารถเชิญพนักงานได้" };
  }

  const name = input.name.trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อ" };
  if (name.length > 100) return { ok: false, error: "ชื่อยาวเกินไป" };

  const email = input.email?.trim() || undefined;
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "รูปแบบอีเมลไม่ถูกต้อง" };
  }
  const phone = input.phone?.trim() || undefined;

  const admin = adminClient();
  const orgId = session.user.org_id;

  const created = await createInviteLinkUser(admin, {
    orgId,
    name,
    email,
    phone,
    role: "staff",
    invitedBy: session.user.id,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const grantErr = await grantModuleAdmin(
    admin,
    orgId,
    created.userId,
    session.user.id,
    moduleSlug,
    "member",
  );
  if (grantErr) {
    // อย่าปล่อยให้ invite ค้างครึ่งๆ กลาง — staff ที่ไม่มี module grant จะ
    // เข้าโปรแกรมไม่ได้ (403) ตั้งแต่กดลิงก์แรก
    await admin.from("users").delete().eq("id", created.userId);
    return { ok: false, error: "ให้สิทธิ์เข้าโปรแกรมไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "PROGRAM_TEAM_INVITED",
    resourceType: "user",
    resourceId: created.userId,
    diff: { new: { name, role: "staff", module: moduleSlug, moduleRole: "member" } },
  });

  return {
    ok: true,
    inviteUrl: `${getBaseUrl()}/invite/${created.token}`,
    expiresAt: created.expiresAt,
  };
}
