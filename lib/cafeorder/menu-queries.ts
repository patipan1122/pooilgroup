// CafeOrder · menu READS (master catalog per brand). Scope every query by orgId.
import { prisma } from "@/lib/prisma";
import { CafeBrand } from "@/lib/generated/prisma/enums";

export type MenuVariant = {
  id: string;
  temp: "hot" | "iced" | "blended" | null;
  size: "regular" | "large";
  priceCents: number;
  isActive: boolean;
};

export type MenuItemRow = {
  id: string;
  name: string;
  description: string | null;
  imageKey: string | null;
  kind: "drink" | "food";
  isActive: boolean;
  categoryId: string;
  categoryName: string;
  variants: MenuVariant[];
};

export type MenuCategory = {
  id: string;
  name: string;
  sortOrder: number;
  itemCount: number;
};

/** All active categories for a brand + their item counts. */
export async function listCategories(orgId: string, brand: CafeBrand): Promise<MenuCategory[]> {
  const cats = await prisma.cafeCategory.findMany({
    where: { orgId, brand, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return cats.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, itemCount: c._count.items }));
}

/** Master menu items (with variants) for a brand, optionally filtered by category. */
export async function listItems(
  orgId: string,
  brand: CafeBrand,
  categoryId?: string,
): Promise<MenuItemRow[]> {
  const items = await prisma.cafeMenuItem.findMany({
    where: { orgId, brand, ...(categoryId ? { categoryId } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: { select: { name: true } },
      variants: { orderBy: [{ temp: "asc" }, { size: "asc" }] },
    },
  });
  return items.map((it) => ({
    id: it.id,
    name: it.name,
    description: it.description,
    imageKey: it.imageKey,
    kind: it.kind,
    isActive: it.isActive,
    categoryId: it.categoryId,
    categoryName: it.category.name,
    variants: it.variants.map((v) => ({
      id: v.id,
      temp: v.temp,
      size: v.size,
      priceCents: v.priceCents,
      isActive: v.isActive,
    })),
  }));
}
