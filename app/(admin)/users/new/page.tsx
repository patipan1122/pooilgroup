import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          ผู้ใช้ใหม่
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          เชิญ <span className="accent">ผู้ใช้</span> เข้าระบบ
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          ระบบจะสร้าง invite link หมดอายุ 48 ชั่วโมง — copy ส่งใน LINE/Email ให้คนที่ต้องเชิญ
        </p>
      </div>

      <InviteForm branches={branches ?? []} />
    </div>
  );
}
