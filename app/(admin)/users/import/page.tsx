import { requireRole } from "@/lib/auth/session";
import { ImportClient } from "./import-client";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";

export default async function ImportUsersPage() {
  await requireRole("super_admin", "org_admin", "admin");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <BackButton label="กลับไปรายชื่อผู้ใช้" fallbackHref="/users" />

      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-semibold text-[var(--color-brand-600)]">
          จัดการระบบ
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          นำเข้า <span className="accent">ผู้ใช้หลายคน</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          วาง CSV จาก Excel · สูงสุด 200 คน/ครั้ง · invite link จะถูกสร้างให้ทุกคน
        </p>
      </header>

      <ImportClient />
    </div>
  );
}
