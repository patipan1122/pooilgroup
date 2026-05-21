"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stockReceive } from "@/lib/clawfleet/actions";

type Product = { id: string; name: string; sku: string; unitCostCents: number };

export function StockReceiveForm({
  defaultBranchId,
  branches,
  products,
}: {
  defaultBranchId?: string;
  branches: { id: string; name: string }[];
  products: Product[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    branchId: defaultBranchId ?? branches[0]?.id ?? "",
    productId: products[0]?.id ?? "",
    qty: "",
    unitCostCents: products[0]?.unitCostCents.toString() ?? "0",
    notes: "",
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await stockReceive({
        branchId: form.branchId,
        productId: form.productId,
        qty: Number(form.qty),
        unitCostCents: Number(form.unitCostCents) || 0,
        notes: form.notes || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/clawfleet/stock?branch=${form.branchId}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">สาขา</span>
        <select
          value={form.branchId}
          onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">สินค้า</span>
        <select
          value={form.productId}
          onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value);
            setForm((f) => ({
              ...f,
              productId: e.target.value,
              unitCostCents: p?.unitCostCents.toString() ?? f.unitCostCents,
            }));
          }}
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
        <span className="text-xs text-zinc-600">จำนวน</span>
        <input
          required
          inputMode="numeric"
          value={form.qty}
          onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value.replace(/[^0-9]/g, "") }))}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-lg font-bold"
        />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">ราคาทุน/ตัว (สตางค์)</span>
        <input
          inputMode="numeric"
          value={form.unitCostCents}
          onChange={(e) => setForm((f) => ({ ...f, unitCostCents: e.target.value.replace(/[^0-9]/g, "") }))}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-zinc-600">หมายเหตุ</span>
        <input
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
          placeholder="เลขใบเสร็จ / ร้าน / ฯลฯ"
        />
      </label>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={pending || !form.qty}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "กำลังบันทึก..." : "บันทึกรับเข้า"}
      </button>
    </form>
  );
}
