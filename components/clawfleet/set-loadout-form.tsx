"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMachineLoadout, setExchangerLoadout } from "@/lib/clawfleet/actions";
import type { PromoTier } from "@/lib/clawfleet/types";

type Product = { id: string; name: string; sku: string; defaultPriceCoins: number };

export function SetClawLoadoutForm({
  machineId,
  products,
  currentProductId,
  currentPricePerPlayCoins,
}: {
  machineId: string;
  products: Product[];
  currentProductId: string | null;
  currentPricePerPlayCoins: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [productId, setProductId] = useState(currentProductId ?? products[0]?.id ?? "");
  const [price, setPrice] = useState(String(currentPricePerPlayCoins ?? 1));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOk(false);
    startTransition(async () => {
      const r = await setMachineLoadout({
        machineId,
        productId,
        pricePerPlayCoins: Number(price) || 1,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="font-semibold text-zinc-900">ตั้งสินค้า + ราคา</h2>
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">สินค้า</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sku})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">ราคาเล่น (เหรียญ/ครั้ง · ปกติ 1 เหรียญ = ฿10)</span>
        <input
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-lg font-bold"
        />
      </label>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-2 text-xs text-red-800">{error}</div>
      )}
      {ok && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800">
          ✅ บันทึกแล้ว
        </div>
      )}
      <button
        type="submit"
        disabled={pending || !productId}
        className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "..." : "บันทึก loadout"}
      </button>
    </form>
  );
}

export function SetExchangerLoadoutForm({
  machineId,
  current,
}: {
  machineId: string;
  current: { baseCoinPerBaht: number; promoTiers: PromoTier[] } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [rate, setRate] = useState(String(current?.baseCoinPerBaht ?? 1));
  const [tiers, setTiers] = useState<{ thb: string; coins: string }[]>(
    current?.promoTiers && current.promoTiers.length > 0
      ? current.promoTiers.map((t) => ({ thb: String(t.thb), coins: String(t.coins) }))
      : [{ thb: "100", coins: "11" }],
  );

  function addTier() {
    setTiers((t) => [...t, { thb: "", coins: "" }]);
  }
  function removeTier(i: number) {
    setTiers((t) => t.filter((_, j) => j !== i));
  }
  function updateTier(i: number, k: "thb" | "coins", v: string) {
    setTiers((t) => t.map((row, j) => (j === i ? { ...row, [k]: v.replace(/[^0-9]/g, "") } : row)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOk(false);
    const parsedTiers: PromoTier[] = tiers
      .filter((t) => t.thb && t.coins)
      .map((t) => ({ thb: Number(t.thb), coins: Number(t.coins) }));
    startTransition(async () => {
      const r = await setExchangerLoadout({
        machineId,
        baseCoinPerBaht: Number(rate) || 1,
        promoTiers: parsedTiers,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="font-semibold text-zinc-900">ตั้งอัตรา + Promo</h2>
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">อัตราพื้นฐาน (฿1 = กี่เหรียญ)</span>
        <input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-lg font-bold"
        />
      </label>
      <div>
        <div className="mb-2 text-xs text-zinc-600">Promo (เช่น 100฿ → 11 เหรียญ)</div>
        <div className="space-y-2">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                inputMode="numeric"
                placeholder="บาท"
                value={t.thb}
                onChange={(e) => updateTier(i, "thb", e.target.value)}
                className="w-24 rounded-xl border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-zinc-500">→</span>
              <input
                inputMode="numeric"
                placeholder="เหรียญ"
                value={t.coins}
                onChange={(e) => updateTier(i, "coins", e.target.value)}
                className="w-24 rounded-xl border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => removeTier(i)}
                className="ml-auto text-xs text-red-600"
              >
                ลบ
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addTier}
          className="mt-2 text-xs font-medium text-blue-600 hover:underline"
        >
          + เพิ่ม promo
        </button>
      </div>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-2 text-xs text-red-800">{error}</div>
      )}
      {ok && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800">
          ✅ บันทึกแล้ว
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "..." : "บันทึก promo"}
      </button>
    </form>
  );
}
