"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { MenuCategory, MenuItemRow, MenuVariant } from "@/lib/cafeorder/menu-queries";
import { createCategory, createItem, toggleItemActive } from "@/lib/cafeorder/menu-actions";
import { CafeBrand, CafeItemKind, CafeSize, CafeTemp } from "@/lib/generated/prisma/enums";

const TEMP_LABEL: Record<string, string> = { hot: "ร้อน", iced: "เย็น", blended: "ปั่น" };

function baht(cents: number): string {
  return (cents / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** "ร้อน 55 · เย็น 70 · ปั่น 75" (ราคาปกติ · +ใหญ่ ถ้ามี) */
function variantSummary(variants: MenuVariant[]): string {
  const byTemp = new Map<string, MenuVariant[]>();
  for (const v of variants) {
    const key = v.temp ?? "single";
    if (!byTemp.has(key)) byTemp.set(key, []);
    byTemp.get(key)!.push(v);
  }
  const parts: string[] = [];
  for (const [key, vs] of byTemp) {
    const reg = vs.find((x) => x.size === "regular") ?? vs[0];
    const large = vs.find((x) => x.size === "large");
    const label = key === "single" ? "" : TEMP_LABEL[key] + " ";
    let s = `${label}${baht(reg.priceCents)}`;
    if (large) s += ` (ใหญ่ +${baht(large.priceCents - reg.priceCents)})`;
    parts.push(s);
  }
  return parts.join(" · ");
}

export function MenuClient({
  brand,
  categories,
  items,
}: {
  brand: CafeBrand;
  categories: MenuCategory[];
  items: MenuItemRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [showAddCat, setShowAddCat] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);

  const itemsByCat = new Map<string, MenuItemRow[]>();
  for (const it of items) {
    if (!itemsByCat.has(it.categoryId)) itemsByCat.set(it.categoryId, []);
    itemsByCat.get(it.categoryId)!.push(it);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : (r.error ?? "ผิดพลาด"));
    });
  }

  return (
    <div className="mx-auto max-w-4xl p-5">
      {/* header + brand switch */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-zinc-900">จัดการเมนู</h1>
        <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
          <Link
            href="/cafeorder/office/menu?brand=amazon"
            className={`rounded-md px-3 py-1.5 font-semibold ${brand === "amazon" ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
          >
            Café Amazon
          </Link>
          <Link
            href="/cafeorder/office/menu?brand=punthai"
            className={`rounded-md px-3 py-1.5 font-semibold ${brand === "punthai" ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
          >
            พันธุ์ไทย
          </Link>
        </div>
      </div>

      {/* toolbar */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setShowAddItem((v) => !v)}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          disabled={pending || !categories.length}
        >
          + เพิ่มเมนู
        </button>
        <button
          onClick={() => setShowAddCat((v) => !v)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700"
          disabled={pending}
        >
          + เพิ่มหมวด
        </button>
        <a
          href={`/api/cafeorder/menu/template?brand=${brand}`}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700"
        >
          ⬇ โหลด template
        </a>
        <Link
          href={`/cafeorder/office/menu/import?brand=${brand}`}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700"
        >
          ⬆ นำเข้าไฟล์
        </Link>
      </div>

      {msg && (
        <div className="mb-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700" role="status">
          {msg}
        </div>
      )}

      {showAddCat && <AddCategoryForm brand={brand} pending={pending} onSubmit={run} onDone={() => setShowAddCat(false)} />}
      {showAddItem && categories.length > 0 && (
        <AddItemForm brand={brand} categories={categories} pending={pending} onSubmit={run} onDone={() => setShowAddItem(false)} />
      )}

      {/* menu list grouped by category */}
      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          ยังไม่มีเมนู — กด “+ เพิ่มหมวด” เพื่อเริ่ม หรือ “⬇ โหลด template” แล้วนำเข้าทีเดียวหลายรายการ
        </div>
      ) : (
        <div className="space-y-5">
          {categories.map((cat) => (
            <section key={cat.id}>
              <h2 className="mb-2 text-sm font-bold text-zinc-500">
                {cat.name} <span className="font-normal">({cat.itemCount})</span>
              </h2>
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
                {(itemsByCat.get(cat.id) ?? []).map((it) => (
                  <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400">
                      {it.imageKey ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageKey} alt="" className="size-10 rounded-lg object-cover" />
                      ) : (
                        "☕"
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-zinc-900">{it.name}</div>
                      <div className="truncate text-xs text-zinc-500">{variantSummary(it.variants)}</div>
                    </div>
                    <button
                      onClick={() => run(() => toggleItemActive({ id: it.id, isActive: !it.isActive }), "อัปเดตแล้ว")}
                      disabled={pending}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${it.isActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-400"}`}
                    >
                      {it.isActive ? "●ขายอยู่" : "○ปิด"}
                    </button>
                  </div>
                ))}
                {(itemsByCat.get(cat.id) ?? []).length === 0 && (
                  <div className="px-4 py-3 text-xs text-zinc-400">ยังไม่มีเมนูในหมวดนี้</div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AddCategoryForm({
  brand,
  pending,
  onSubmit,
  onDone,
}: {
  brand: CafeBrand;
  pending: boolean;
  onSubmit: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อหมวด (เช่น กาแฟ, ชา, ปั่น)"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            onSubmit(() => createCategory({ brand, name }), "เพิ่มหมวดแล้ว");
            setName("");
            onDone();
          }}
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

function AddItemForm({
  brand,
  categories,
  pending,
  onSubmit,
  onDone,
}: {
  brand: CafeBrand;
  categories: MenuCategory[];
  pending: boolean;
  onSubmit: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [kind, setKind] = useState<CafeItemKind>(CafeItemKind.drink);
  const [priceHot, setPriceHot] = useState("");
  const [priceIced, setPriceIced] = useState("");
  const [priceBlended, setPriceBlended] = useState("");
  const [priceFood, setPriceFood] = useState("");

  function build(): { temp: CafeTemp | null; size: CafeSize; priceCents: number }[] {
    const out: { temp: CafeTemp | null; size: CafeSize; priceCents: number }[] = [];
    const push = (temp: CafeTemp | null, raw: string) => {
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0) out.push({ temp, size: CafeSize.regular, priceCents: Math.round(n * 100) });
    };
    if (kind === CafeItemKind.food) {
      push(null, priceFood);
    } else {
      push(CafeTemp.hot, priceHot);
      push(CafeTemp.iced, priceIced);
      push(CafeTemp.blended, priceBlended);
    }
    return out;
  }

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อเมนู"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 text-sm">
        <button
          onClick={() => setKind(CafeItemKind.drink)}
          className={`rounded-lg px-3 py-1.5 font-semibold ${kind === "drink" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-600"}`}
        >
          เครื่องดื่ม
        </button>
        <button
          onClick={() => setKind(CafeItemKind.food)}
          className={`rounded-lg px-3 py-1.5 font-semibold ${kind === "food" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-600"}`}
        >
          ของกิน
        </button>
      </div>
      {kind === CafeItemKind.drink ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">
            <span className="text-zinc-500">ราคาร้อน</span>
            <input value={priceHot} onChange={(e) => setPriceHot(e.target.value)} inputMode="decimal" placeholder="-" className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5" />
          </label>
          <label className="text-sm">
            <span className="text-zinc-500">ราคาเย็น</span>
            <input value={priceIced} onChange={(e) => setPriceIced(e.target.value)} inputMode="decimal" placeholder="-" className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5" />
          </label>
          <label className="text-sm">
            <span className="text-zinc-500">ราคาปั่น</span>
            <input value={priceBlended} onChange={(e) => setPriceBlended(e.target.value)} inputMode="decimal" placeholder="-" className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5" />
          </label>
        </div>
      ) : (
        <label className="block text-sm">
          <span className="text-zinc-500">ราคา</span>
          <input value={priceFood} onChange={(e) => setPriceFood(e.target.value)} inputMode="decimal" placeholder="-" className="mt-1 w-40 rounded-lg border border-zinc-300 px-2 py-1.5" />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg px-3 py-2 text-sm text-zinc-500">
          ยกเลิก
        </button>
        <button
          onClick={() => {
            const variants = build();
            if (!name.trim() || !categoryId || !variants.length) return;
            onSubmit(() => createItem({ brand, categoryId, name, kind, variants }), "เพิ่มเมนูแล้ว");
            onDone();
          }}
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          บันทึกเมนู
        </button>
      </div>
    </div>
  );
}
