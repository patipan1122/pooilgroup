// CafeOrder · หน้าจัดการเมนู (server) — โหลด master menu ต่อแบรนด์ แล้ว render client.
import { requireSession } from "@/lib/auth/session";
import { listCategories, listItems } from "@/lib/cafeorder/menu-queries";
import { CafeBrand } from "@/lib/generated/prisma/enums";
import { MenuClient } from "./menu-client";

export const dynamic = "force-dynamic";

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const sp = await searchParams;
  const brand: CafeBrand = sp.brand === "punthai" ? CafeBrand.punthai : CafeBrand.amazon;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const [categories, items] = await Promise.all([
    listCategories(orgId, brand),
    listItems(orgId, brand),
  ]);

  return <MenuClient brand={brand} categories={categories} items={items} />;
}
