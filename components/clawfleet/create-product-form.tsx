"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProduct } from "@/lib/clawfleet/actions";

export function CreateProductForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    sku: "",
    name: "",
    category: "PLUSH",
    defaultPriceCoins: "1",
    unitCostCents: "0",
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createProduct({
        sku: form.sku,
        name: form.name,
        category: form.category,
        defaultPriceCoins: Number(form.defaultPriceCoins) || 1,
        unitCostCents: Number(form.unitCostCents) || 0,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setForm({ sku: "", name: "", category: "PLUSH", defaultPriceCoins: "1", unitCostCents: "0" });
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        + เพิ่มสินค้า
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          required
          placeholder="SKU"
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="ชื่อสินค้า"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="PLUSH">ตุ๊กตา</option>
          <option value="TOY">ของเล่น</option>
          <option value="UTILITY">ของใช้</option>
          <option value="MYSTERY_BOX">กล่องสุ่ม</option>
          <option value="MODEL">โมเดล</option>
          <option value="KEYCHAIN">พวงกุญแจ</option>
          <option value="SNACK">ขนม</option>
          <option value="OTHER">อื่นๆ</option>
        </select>
        <input
          inputMode="numeric"
          placeholder="ราคาเล่น (เหรียญ)"
          value={form.defaultPriceCoins}
          onChange={(e) =>
            setForm((f) => ({ ...f, defaultPriceCoins: e.target.value.replace(/[^0-9]/g, "") }))
          }
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
        />
        <input
          inputMode="numeric"
          placeholder="ราคาทุน (สตางค์)"
          value={form.unitCostCents}
          onChange={(e) =>
            setForm((f) => ({ ...f, unitCostCents: e.target.value.replace(/[^0-9]/g, "") }))
          }
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-300"
        >
          {pending ? "..." : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
