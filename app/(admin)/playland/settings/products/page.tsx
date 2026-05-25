import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { ProductsClient } from "@/components/playland/settings/products-client";

export const dynamic = "force-dynamic";

export default async function ProductsSettingsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const [branches, products] = await Promise.all([
    listBranches(orgId),
    prisma.playlandProduct.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
  ]);
  return <ProductsClient
    branches={branches.map((b) => ({ id: b.id, name: b.name }))}
    products={products.map((p) => ({
      id: p.id, branchId: p.branchId, name: p.name, barcode: p.barcode, sku: p.sku, category: p.category, priceCents: p.priceCents, costCents: p.costCents, stock: p.stock, reorderLevel: p.reorderLevel, active: p.active,
    }))}
  />;
}
