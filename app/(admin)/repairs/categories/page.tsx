// /repairs/categories — manage repair categories (Pooil App redesign)
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import { listCategories } from "@/lib/repair/queries";
import { CategoryAdmin } from "@/components/repair/category-admin";
import { RepairSubHeader } from "@/components/repair/sub-header";
import { ListChecks } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);
  const cats = await listCategories(session.user.org_id);

  const urgentCount = cats.filter((c) => c.defaultUrgency === "URGENT").length;
  const normalCount = cats.filter((c) => c.defaultUrgency === "NORMAL").length;
  const lowCount = cats.filter((c) => c.defaultUrgency === "LOW").length;

  return (
    <>
      <RepairSubHeader
        icon={ListChecks}
        eyebrow="Setup · Categories"
        title="หมวดงานซ่อม"
        subtitle="ใช้แยกประเภทงานในฟอร์มแจ้งซ่อม · ผู้แจ้งเลือกหมวดได้ · ระบบจะแนะนำเร่งด่วน default ตามหมวด"
        stats={[
          { label: "ทั้งหมด", value: cats.length },
          { label: "เร่งด่วน", value: urgentCount, tone: "danger" },
          { label: "ปานกลาง", value: normalCount },
          { label: "ไม่เร่ง", value: lowCount },
        ]}
      />
      <div className="p-3 sm:p-5 lg:p-6 max-w-3xl mx-auto">
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
    </>
  );
}
