import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listAccessibleBranches, getStockBalance, listProducts } from "@/lib/clawfleet/queries";
import { StockCountForm } from "@/components/clawfleet/stock-count-form";

export const dynamic = "force-dynamic";

export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const params = await searchParams;
  const branches = await listAccessibleBranches();
  const branchId = params.branch ?? branches[0]?.id;
  if (!branchId) {
    return <p className="p-6 text-sm text-zinc-500">ไม่มีสาขาให้นับ</p>;
  }
  const [balance, products] = await Promise.all([getStockBalance(branchId), listProducts()]);
  // include zero-stock products too
  const seen = new Set(balance.map((b) => b.product.id));
  const rest = products
    .filter((p) => !seen.has(p.id))
    .map((p) => ({ product: p, qty: 0 }));
  const rows = [...balance, ...rest];

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 sm:p-6">
      <Link
        href="/clawfleet/stock"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        <ArrowLeft className="h-4 w-4" /> กลับ
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900">นับสต๊อกวันนี้</h1>
      <p className="text-sm text-zinc-500">เทียบ &quot;ที่ระบบคำนวณ&quot; กับ &quot;นับจริง&quot; · ขาด/เกินจะ flag</p>
      <StockCountForm
        branchId={branchId}
        rows={rows.map((r) => ({
          productId: r.product.id,
          name: r.product.name,
          sku: r.product.sku,
          expected: r.qty,
        }))}
      />
    </div>
  );
}
