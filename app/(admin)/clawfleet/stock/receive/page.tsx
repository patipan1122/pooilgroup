import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listAccessibleBranches, listProducts } from "@/lib/clawfleet/queries";
import { StockReceiveForm } from "@/components/clawfleet/stock-receive-form";

export const dynamic = "force-dynamic";

export default async function StockReceivePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const params = await searchParams;
  const [branches, products] = await Promise.all([listAccessibleBranches(), listProducts()]);
  return (
    <div className="mx-auto max-w-md space-y-4 p-4 sm:p-6">
      <Link
        href="/clawfleet/stock"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        <ArrowLeft className="h-4 w-4" /> กลับ
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900">รับสินค้าเข้า</h1>
      <StockReceiveForm
        defaultBranchId={params.branch}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unitCostCents: p.unitCostCents }))}
      />
    </div>
  );
}
