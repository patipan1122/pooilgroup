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
    </div>
  );
}
