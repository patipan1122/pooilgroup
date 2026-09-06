"use server";

// Recruit · self-serve teammate invite — lets whoever administers Recruit
// (global admin tier, OR a program_admin scoped to recruit, OR anyone holding
// a user_modules role='admin' grant for recruit — same set userIsModuleAdmin()
// already uses elsewhere to gate "invite teammate / manage members") invite a
// colleague WITHOUT going through the org-wide /users console — which locks
// appointing any admin-level role to super_admin only (CEO 2026-06-15).
//
// This is a narrow, Recruit-only carve-out of that lock (CEO 2026-09-06): the
// invited person is ALWAYS created as program_admin scoped to "recruit" ONLY —
// the caller cannot pick a different role or a different program, so the
// blast radius of this relaxed permission stays inside this one module. Every
// other program keeps the super_admin-only lock untouched.

import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { audit } from "@/lib/audit/log";
import { createInviteLinkUser, grantModuleAdmin } from "@/lib/auth/invite";
import { getBaseUrl } from "@/lib/utils/base-url";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteRecruitTeammateResult =
  | { ok: true; inviteUrl: string; expiresAt: string }
  | { ok: false; error: string };

export async function inviteRecruitTeammate(input: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<InviteRecruitTeammateResult> {
  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, "recruit"))) {
    return { ok: false, error: "เฉพาะแอดมินของ Recruit เท่านั้นที่เชิญทีมงานได้" };
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
    role: "program_admin",
    invitedBy: session.user.id,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const grantErr = await grantModuleAdmin(
    admin,
    orgId,
    created.userId,
    session.user.id,
    "recruit",
  );
  if (grantErr) {
    // Don't leave a broken invite behind — a program_admin with no module
    // grant gets 403'd out of Recruit the moment they open the link.
    await admin.from("users").delete().eq("id", created.userId);
    return { ok: false, error: "ให้สิทธิ์ดูแล Recruit ไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "RECRUIT_TEAM_INVITED",
    resourceType: "user",
    resourceId: created.userId,
    diff: { new: { name, role: "program_admin", admin_modules: ["recruit"] } },
  });

  return {
    ok: true,
    inviteUrl: `${getBaseUrl()}/invite/${created.token}`,
    expiresAt: created.expiresAt,
  };
}
