import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportUsersPage() {
  await requireRole("super_admin", "org_admin");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <Link
        href="/users"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700] mb-3"
      >
        <ChevronLeft className="size-4" />
        กลับไปรายชื่อผู้ใช้
      </Link>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
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
