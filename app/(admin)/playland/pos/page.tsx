import { requireSession } from "@/lib/auth/session";
import { listBranches, listProducts } from "@/lib/playland/queries";
import { PosClient } from "@/components/playland/pos-client";

export const dynamic = "force-dynamic";

export default async function PosPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;

  if (!branchId) {
    return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;
  }

  const products = await listProducts(orgId, branchId);
  return <PosClient branchId={branchId} products={products.map((p) => ({
    id: p.id, name: p.name, priceCents: p.priceCents, stock: p.stock, barcode: p.barcode, category: p.category,
  }))} />;
}
