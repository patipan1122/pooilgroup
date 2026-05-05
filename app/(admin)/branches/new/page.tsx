import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BranchForm } from "../branch-form";

export const dynamic = "force-dynamic";

export default async function NewBranchPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  // Possible managers (active users who could manage branches)
  const { data: managers } = await admin
    .from("users")
    .select("id, name, role")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .in("role", ["super_admin", "org_admin", "branch_manager"])
    .order("name");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <Link
        href="/branches"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[var(--color-brand-700)] mb-3"
      >
        <ChevronLeft className="size-4" />
        กลับไปรายชื่อสาขา
      </Link>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          จัดการระบบ
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          เพิ่ม <span className="accent">สาขาใหม่</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          กรอกข้อมูลสาขา · รหัสสาขาควรสั้นและจำง่าย เช่น KKN-001, UDR-002
        </p>
      </header>

      <BranchForm mode="create" managers={managers ?? []} />
    </div>
  );
}
