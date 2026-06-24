import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { R2_PUBLIC_URL } from "@/lib/r2/client";
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
    r2PublicUrl={R2_PUBLIC_URL}
    branches={branches.map((b) => ({ id: b.id, name: b.name }))}
    products={products.map((p) => ({
      id: p.id, branchId: p.branchId, kind: p.kind, name: p.name, barcode: p.barcode, sku: p.sku, category: p.category, supplier: p.supplier, priceCents: p.priceCents, costCents: p.costCents, stock: p.stock, reorderLevel: p.reorderLevel, active: p.active, imageR2Path: p.imageR2Path,
    }))}
  />;
}
