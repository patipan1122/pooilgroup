import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { MODULES } from "@/lib/modules";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");

  // Active programs the new user can be made admin of. CostCtrl is the CEO's
  // private cost dashboard — never offer it as a program-admin grant.
  const programs = Object.values(MODULES)
    .filter((m) => m.status === "active" && m.slug !== "costctrl")
    .map((m) => ({ slug: m.slug, name: m.name, emoji: m.emoji }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs font-semibold text-[var(--color-brand-600)]">
          ผู้ใช้ใหม่
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-2">
          เพิ่ม <span className="accent">ผู้ใช้</span> เข้าระบบ
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          เลือกได้ 2 แบบ — ส่ง invite link ให้ตั้งรหัสเอง หรือตั้งรหัสให้เลย
        </p>
      </div>

      <InviteForm branches={branches ?? []} programs={programs} />
    </div>
  );
}
