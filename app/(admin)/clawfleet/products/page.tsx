import { listProducts } from "@/lib/clawfleet/queries";
import { CreateProductForm } from "@/components/clawfleet/create-product-form";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  PLUSH: "ตุ๊กตา",
  TOY: "ของเล่น",
  UTILITY: "ของใช้",
  MYSTERY_BOX: "กล่องสุ่ม",
  MODEL: "โมเดล",
  KEYCHAIN: "พวงกุญแจ",
  SNACK: "ขนม",
  OTHER: "อื่นๆ",
};

export default async function ProductsPage() {
  const products = await listProducts();

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">สินค้า</h1>
        <p className="text-sm text-zinc-500">รายการสินค้าที่ใส่ในตู้คีบ · ราคาทุน · ราคาเล่น</p>
      </header>
      <CreateProductForm />
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">ชื่อ</th>
              <th className="px-4 py-3 font-medium">หมวด</th>
              <th className="px-4 py-3 font-medium text-right">ราคาเล่น</th>
              <th className="px-4 py-3 font-medium text-right">ทุน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {products.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 text-zinc-900">{p.name}</td>
                <td className="px-4 py-3 text-zinc-600">{CATEGORY_LABEL[p.category]}</td>
                <td className="px-4 py-3 text-right">{p.defaultPriceCoins} เหรียญ</td>
                <td className="px-4 py-3 text-right text-zinc-600">
                  ฿{(p.unitCostCents / 100).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
