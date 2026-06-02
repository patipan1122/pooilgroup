// /chairops/bills/categories · CRUD for ChairopsExpenseCategory.
// CEO + ADMIN only. MANAGER+OFFICE bounced via requireRole("CEO") (rank ≥ 4).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/chairops/auth/session";
import { getCategoryList } from "@/lib/chairops/queries/vendor-bills";

import { CategoryRow } from "./_components/category-row";
import { CreateCategoryForm } from "./_components/create-category-form";

export const dynamic = "force-dynamic";

export default async function BillCategoriesPage() {
  // Defense in depth: page-level CEO gate (rank ≥ 4 = CEO+ADMIN, matches actions).
  const session = await requireRole("CEO");
  const categories = await getCategoryList({
    orgId: session.user.orgId,
    includeArchived: true,
  });

  const active = categories.filter((c) => !c.archivedAt);
  const archived = categories.filter((c) => c.archivedAt);

  return (
    <div className="space-y-5">
      <Link
        href="/chairops/bills"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        กลับตารางบิล
      </Link>

      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          การเงิน
        </p>
        <h1 className="text-2xl font-semibold text-zinc-900">
          จัดการหมวดบิล
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          สร้าง · ซ่อน · กู้คืน · หมวดถูกอ้างถึงจากบิลที่บันทึกแล้ว ลบไม่ได้
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-200 bg-white">
            <header className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-800">
              หมวดที่ใช้งาน ({active.length})
            </header>
            <ul className="divide-y divide-zinc-100">
              {active.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-zinc-500">
                  ยังไม่มีหมวด · เพิ่มทางขวา
                </li>
              ) : (
                active.map((c) => (
                  <CategoryRow key={c.id} category={c} variant="active" />
                ))
              )}
            </ul>
          </div>

          {archived.length > 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/60">
              <header className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700">
                หมวดที่ซ่อน ({archived.length})
              </header>
              <ul className="divide-y divide-zinc-100">
                {archived.map((c) => (
                  <CategoryRow key={c.id} category={c} variant="archived" />
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-800">เพิ่มหมวดใหม่</h2>
          <p className="mt-1 text-xs text-zinc-500">
            รหัส = ตัวพิมพ์ใหญ่ A-Z 0-9 _ · เช่น <code>PEST_CONTROL</code>
          </p>
          <CreateCategoryForm />
        </aside>
      </section>
    </div>
  );
}
