import Link from "next/link";
import { listAccessibleBranches, getStockBalance, listStockMovements } from "@/lib/clawfleet/queries";
import { PackageOpen, ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";

const MOVE_LABEL: Record<string, string> = {
  RECEIVE: "รับเข้า",
  LOAD_TO_MACHINE: "เติมเข้าตู้",
  COUNT_SNAPSHOT: "นับสต๊อก",
  ADJUST: "ปรับมือ",
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const params = await searchParams;
  const branches = await listAccessibleBranches();
  const selectedBranch = params.branch ?? branches[0]?.id;
  const [balance, movements] = await Promise.all([
    selectedBranch ? getStockBalance(selectedBranch) : Promise.resolve([]),
    listStockMovements({ branchId: selectedBranch, take: 30 }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">คลังสินค้า</h1>
          <p className="text-sm text-zinc-500">สต๊อกในสาขา · รับเข้า · นับวันนี้</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/clawfleet/stock/receive${selectedBranch ? `?branch=${selectedBranch}` : ""}`}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:border-blue-300"
          >
            <PackageOpen className="h-4 w-4" /> รับเข้า
          </Link>
          <Link
            href={`/clawfleet/stock/count${selectedBranch ? `?branch=${selectedBranch}` : ""}`}
            className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <ClipboardCheck className="h-4 w-4" /> นับวันนี้
          </Link>
        </div>
      </header>

      <form className="flex flex-wrap gap-2" method="GET">
        <select
          name="branch"
          defaultValue={selectedBranch ?? ""}
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          ดูสาขานี้
        </button>
      </form>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-100 p-4 font-semibold text-zinc-900">
          สต๊อกคงเหลือ
        </h2>
        {balance.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            ยังไม่มีข้อมูลสต๊อก · กดรับเข้าเพื่อบันทึก
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">สินค้า</th>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium text-right">จำนวน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {balance.map((b) => (
                <tr key={b.product.id}>
                  <td className="px-4 py-2 text-zinc-900">{b.product.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">{b.product.sku}</td>
                  <td
                    className={`px-4 py-2 text-right font-semibold ${
                      b.qty < 0
                        ? "text-red-600"
                        : b.qty < 10
                          ? "text-amber-700"
                          : "text-zinc-900"
                    }`}
                  >
                    {b.qty.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-100 p-4 font-semibold text-zinc-900">
          การเคลื่อนไหวล่าสุด
        </h2>
        {movements.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">ยังไม่มีรายการ</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {movements.map((m) => (
              <li key={m.id} className="flex items-start justify-between p-4 text-sm">
                <div>
                  <div className="font-medium text-zinc-900">{m.product.name}</div>
                  <div className="text-xs text-zinc-500">
                    {MOVE_LABEL[m.type]} · {m.branch.name} · {m.createdBy.name}
                  </div>
                  {m.reason && <div className="text-xs text-zinc-400">{m.reason}</div>}
                </div>
                <div className="text-right">
                  <div
                    className={`font-bold ${
                      m.qty > 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {m.qty > 0 ? "+" : ""}
                    {m.qty}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {new Date(m.occurredAt).toLocaleDateString("th-TH")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
