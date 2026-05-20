// /repairs/categories — manage repair categories
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import { listCategories } from "@/lib/repair/queries";
import { CategoryAdmin } from "@/components/repair/category-admin";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);
  const cats = await listCategories(session.user.org_id);

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
          หมวดงานซ่อม
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          ใช้แยกประเภทงานในฟอร์มแจ้งซ่อม · ผู้แจ้งเลือกหมวดได้
        </p>
      </header>
      <CategoryAdmin
        categories={cats.map((c) => ({
          id: c.id,
          slug: c.slug,
          label: c.label,
          emoji: c.emoji,
          defaultUrgency: c.defaultUrgency,
          sortOrder: c.sortOrder,
        }))}
      />
    </div>
  );
}
