import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineByCode, listProducts, listGroups } from "@/lib/clawfleet/queries";
import { formatTHB } from "@/lib/clawfleet/validation";
import { ArrowLeft } from "lucide-react";
import { SetClawLoadoutForm, SetExchangerLoadoutForm } from "@/components/clawfleet/set-loadout-form";
import { AssignMachineGroupForm } from "@/components/clawfleet/assign-machine-group-form";
import type { PromoTier } from "@/lib/clawfleet/types";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const m = await getMachineByCode(code);
  if (!m) notFound();
  const [products, groups] = await Promise.all([listProducts(), listGroups()]);
  const branchGroups = groups.filter((g) => g.branch.id === m.branch.id);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link
        href="/clawfleet/machines"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        <ArrowLeft className="h-4 w-4" /> กลับ
      </Link>

      <header className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{m.code}</h1>
            <p className="text-sm text-zinc-500">
              {m.kind === "CLAW" ? "ตู้คีบ" : "ตู้แลก"} · {m.branch.name}
              {m.group ? ` · ${m.group.name}` : ""}
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            {m.nickname && <div className="font-medium text-zinc-700">{m.nickname}</div>}
            <div>
              {m.isActive ? "● active" : "○ ปิด"}
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-3">
        <Stat label="มิเตอร์เหรียญ" value={m.lastCoinMeter.toLocaleString()} />
        {m.kind === "CLAW" && (
          <>
            <Stat label="มิเตอร์ตุ๊กตา" value={m.lastDollMeter.toLocaleString()} />
            <Stat label="สต๊อกในตู้" value={`${m.lastDollStock} ตัว`} />
          </>
        )}
      </section>

      <AssignMachineGroupForm
        machineId={m.id}
        currentGroupId={m.groupId}
        groups={branchGroups.map((g) => ({ id: g.id, name: g.name }))}
      />

      {m.kind === "CLAW" ? (
        <SetClawLoadoutForm
          machineId={m.id}
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            defaultPriceCoins: p.defaultPriceCoins,
          }))}
          currentProductId={m.loadouts[0]?.productId ?? null}
          currentPricePerPlayCoins={m.loadouts[0]?.pricePerPlayCoins ?? null}
        />
      ) : (
        <SetExchangerLoadoutForm
          machineId={m.id}
          current={
            m.exchangerLoadouts[0]
              ? {
                  baseCoinPerBaht: Number(m.exchangerLoadouts[0].baseCoinPerBaht),
                  promoTiers: (m.exchangerLoadouts[0].promoTiers as unknown as PromoTier[]) ?? [],
                }
              : null
          }
        />
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-100 p-4 font-semibold text-zinc-900">ประวัติ 30 รอบ</h2>
        {m.events.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">ยังไม่มีประวัติ</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">เวลา</th>
                <th className="px-3 py-2 font-medium">ชนิด</th>
                <th className="px-3 py-2 font-medium text-right">เหรียญ</th>
                <th className="px-3 py-2 font-medium text-right">เงินสด</th>
                <th className="px-3 py-2 font-medium">flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {m.events.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-xs">
                    {new Date(e.collectedAt).toLocaleString("th-TH", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 text-xs">{e.eventType}</td>
                  <td className="px-3 py-2 text-right">
                    {(e.coinMeterAfter - e.coinMeterBefore).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">{formatTHB(e.cashCountedCents)}</td>
                  <td className="px-3 py-2 text-xs text-amber-700">
                    {e.anomalyFlags.length > 0 ? e.anomalyFlags.length : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-bold text-zinc-900">{value}</div>
    </div>
  );
}
