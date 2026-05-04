import { adminClient } from "@/lib/db/server";
import { InviteAcceptForm } from "./accept-form";
import { CheckCircle2, Crown, UserPlus, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = adminClient();

  const { data: pending } = await admin
    .from("users")
    .select("id, email, name, phone, role, invite_expires_at, invite_used_at, is_active")
    .eq("invite_token", token)
    .maybeSingle();

  const expired = pending?.invite_expires_at
    ? new Date(pending.invite_expires_at) < new Date()
    : false;
  const used = !!pending?.invite_used_at;

  if (!pending || expired || used || pending.is_active) {
    return (
      <div className="w-full max-w-md text-center animate-fade-up">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-red-100 text-red-600 mb-4">
          <AlertCircle className="size-7" strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display">
          Invite Link <span className="accent">ใช้ไม่ได้</span>
        </h1>
        <p className="text-sm text-zinc-500 mt-2">
          {!pending && "ไม่พบ invite — ลิงก์อาจผิดหรือถูกลบ"}
          {expired && "Invite หมดอายุแล้ว — ขอ Admin สร้างใหม่"}
          {used && "Invite ใช้ไปแล้ว — เข้าสู่ระบบที่หน้า Login"}
          {pending?.is_active && "บัญชีนี้ activate แล้ว — เข้าสู่ระบบที่หน้า Login"}
        </p>
        <a
          href="/login"
          className="inline-block mt-6 font-semibold text-[--color-brand-700] hover:underline"
        >
          ไปหน้า Login →
        </a>
      </div>
    );
  }

  const isAdmin = pending.role === "super_admin" || pending.role === "org_admin";

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center text-center animate-fade-up">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[--color-brand-600] text-white mb-5 shadow-blue">
          {isAdmin ? (
            <Crown className="size-7" strokeWidth={2.5} />
          ) : (
            <UserPlus className="size-7" strokeWidth={2.5} />
          )}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight font-display">
          ยินดีต้อนรับ <span className="accent">{pending.name}</span>
        </h1>
        <p className="text-sm text-zinc-500 mt-2">
          ตั้งรหัสผ่านเพื่อเริ่มใช้งาน Pool Group ERP
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-md p-6 sm:p-8 animate-fade-up delay-100">
        <div className="mb-5 rounded-xl bg-[--color-brand-50] border border-[--color-brand-200] px-4 py-3 text-sm">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="size-5 text-[--color-brand-600] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[--color-brand-800]">
                {pending.email ?? pending.phone ?? pending.name}
              </div>
              <div className="text-xs text-[--color-brand-700] mt-0.5">
                บทบาท: {ROLE_LABEL[pending.role] ?? pending.role}
              </div>
            </div>
          </div>
        </div>
        <InviteAcceptForm token={token} email={pending.email ?? null} userId={pending.id} />
      </div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "ผู้จัดการสาขา",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};
