import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BranchImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportBranchesPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companies } = await (admin.from as any)("companies")
    .select("id, code, name")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <Link
        href="/users"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[var(--color-brand-700)] mb-3"
      >
        <ChevronLeft className="size-4" />
        กลับไปทีม & สาขา
      </Link>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          จัดการระบบ
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          นำเข้า <span className="brand-gradient-text">สาขาหลายสาขา</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          วาง CSV จาก Excel · สูงสุด 200 สาขา/ครั้ง · เพิ่มทุกสาขาในไฟล์เข้าระบบทันที
        </p>
      </header>

      <BranchImportClient companies={companies ?? []} />
    </div>
  );
}
