import Link from "next/link";
import { ShieldCheck, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireSession();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
          บัญชี
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          โปรไฟล์ <span className="accent">ของฉัน</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          แก้ไขข้อมูลส่วนตัว · เปลี่ยนรหัสผ่าน
        </p>
      </div>
      <ProfileForm
        userId={session.user.id}
        name={session.user.name}
        email={session.user.email}
        phone={session.user.phone}
        role={session.user.role}
      />

      <Link
        href="/profile/sessions"
        className="mt-4 flex items-center justify-between gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3.5 hover:border-[--color-brand-300] hover:bg-[--color-brand-50]/40 transition-colors animate-fade-up delay-200"
      >
        <span className="flex items-center gap-3">
          <span className="size-10 rounded-xl bg-[--color-brand-50] border border-[--color-brand-200] flex items-center justify-center text-[--color-brand-700]">
            <ShieldCheck className="size-5" />
          </span>
          <span>
            <span className="block font-semibold text-sm">
              อุปกรณ์ที่เข้าใช้
            </span>
            <span className="block text-xs text-zinc-500">
              ดู Login จากที่ไหนบ้าง · ออกจากระบบที่ไม่ใช่ของคุณ
            </span>
          </span>
        </span>
        <ChevronRight className="size-5 text-zinc-400" />
      </Link>
    </div>
  );
}
