import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getGroupDetail } from "@/lib/clawfleet/queries";

export const dynamic = "force-dynamic";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const g = await getGroupDetail(id);
  if (!g) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link
        href="/clawfleet/groups"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        <ArrowLeft className="h-4 w-4" /> กลับ
      </Link>

      <header className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-zinc-900">{g.name}</h1>
        <p className="text-sm text-zinc-500">
          {g.branch.name} · tolerance {(g.toleranceBps / 100).toFixed(1)}%
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-zinc-900">🪙 ตู้แลก</h2>
        {g.exchanger ? (
          <Link
            href={`/clawfleet/machines/${g.exchanger.code}`}
            className="block rounded-xl border border-amber-200 bg-amber-50/40 p-3 hover:border-amber-300"
          >
            <div className="font-mono text-sm text-amber-800">{g.exchanger.code}</div>
            <div className="text-xs text-zinc-500">
              มิเตอร์ล่าสุด {g.exchanger.lastCoinMeter.toLocaleString()}
            </div>
          </Link>
        ) : (
          <p className="text-sm text-zinc-500">ยังไม่มีตู้แลกในกลุ่มนี้</p>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-zinc-900">🧸 ตู้คีบ ({g.machines.length})</h2>
        {g.machines.filter((m) => m.kind === "CLAW").length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีตู้คีบในกลุ่ม</p>
        ) : (
          <ul className="space-y-1.5">
            {g.machines
              .filter((m) => m.kind === "CLAW")
              .map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/clawfleet/machines/${m.code}`}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 hover:border-blue-300"
                  >
                    <div>
                      <div className="font-mono text-sm font-semibold text-zinc-900">
                        {m.code}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {m.loadouts[0]?.product.name ?? "ยังไม่ตั้งสินค้า"}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <div>
                        มิเตอร์ {m.lastCoinMeter.toLocaleString()}
                      </div>
                      <div className={m.lastDollStock < 10 ? "font-bold text-red-600" : ""}>
                        สต๊อก {m.lastDollStock}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
