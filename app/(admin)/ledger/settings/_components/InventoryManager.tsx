"use client";

// InventoryManager — คลังสินค้า/SKU config (LEDGER_STOCKIN_V1).
// ดึง SKU จาก TRCloud (ต่อหมวดธุรกิจ) · ติ๊ก "เก็บสต๊อก" · ตั้งจำนวนต่อแพ็ค (1 ลัง = N ชิ้น) ·
// ดู/ลบการจับคู่ชื่อบนใบเสร็จ → SKU. ไม่สร้าง SKU เอง — mirror ของ TRCloud เท่านั้น.

import { useMemo, useState, useTransition } from "react";
import { Boxes, Loader2, RefreshCw, Check, Search } from "lucide-react";
import {
  syncSkusAction,
  toggleSkuStockTracked,
  setSkuPackFactor,
  deleteSkuAlias,
} from "../../_stockin-actions";

type Sku = {
  id: string;
  productId: string;
  productName: string | null;
  businessGroup: string | null;
  unit: string | null;
  packFactor: number;
  stockTracked: boolean;
  status: string | null;
  balance: number | null;
  syncedAt: string | null;
};
type Alias = { id: string; aliasKey: string; skuId: string; source: string };

export function InventoryManager({
  companyId,
  skus,
  aliases,
}: {
  companyId: string;
  skus: Sku[];
  aliases: Alias[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncKeyword, setSyncKeyword] = useState("");
  const [q, setQ] = useState("");
  // optimistic local state for toggles/pack so the UI feels instant
  const [local, setLocal] = useState<Record<string, { stockTracked: boolean; packFactor: number }>>(
    () => Object.fromEntries(skus.map((s) => [s.id, { stockTracked: s.stockTracked, packFactor: s.packFactor }])),
  );
  const aliasBySku = useMemo(() => {
    const m = new Map<string, Alias[]>();
    for (const a of aliases) (m.get(a.skuId) ?? m.set(a.skuId, []).get(a.skuId)!).push(a);
    return m;
  }, [aliases]);

  const groups = useMemo(() => {
    const filtered = q.trim()
      ? skus.filter(
          (s) =>
            s.productId.toLowerCase().includes(q.toLowerCase()) ||
            (s.productName ?? "").toLowerCase().includes(q.toLowerCase()),
        )
      : skus;
    const g = new Map<string, Sku[]>();
    for (const s of filtered) {
      const key = s.businessGroup || "(ไม่มีหมวดธุรกิจ)";
      (g.get(key) ?? g.set(key, []).get(key)!).push(s);
    }
    return [...g.entries()];
  }, [skus, q]);

  function runSync() {
    setMsg(null);
    start(async () => {
      const res = await syncSkusAction(companyId, syncKeyword.trim() || undefined);
      setMsg(
        res.ok
          ? { kind: "ok", text: `ดึงสินค้าจาก TRCloud ${res.synced ?? 0} รายการ · refresh หน้าเพื่อดูล่าสุด` }
          : { kind: "err", text: res.error ?? "ดึงไม่สำเร็จ" },
      );
    });
  }
  function toggle(sku: Sku) {
    const next = !(local[sku.id]?.stockTracked ?? sku.stockTracked);
    setLocal((p) => ({ ...p, [sku.id]: { ...p[sku.id], stockTracked: next } }));
    start(async () => {
      const res = await toggleSkuStockTracked(sku.id, companyId, next);
      if (!res.ok) {
        setLocal((p) => ({ ...p, [sku.id]: { ...p[sku.id], stockTracked: !next } }));
        setMsg({ kind: "err", text: res.error ?? "ทำรายการไม่สำเร็จ" });
      }
    });
  }
  function savePack(sku: Sku, val: string) {
    const f = Number(val);
    if (!(f > 0)) return;
    setLocal((p) => ({ ...p, [sku.id]: { ...p[sku.id], packFactor: f } }));
    start(async () => {
      const res = await setSkuPackFactor(sku.id, companyId, f);
      if (!res.ok) setMsg({ kind: "err", text: res.error ?? "บันทึกไม่สำเร็จ" });
    });
  }
  function delAlias(id: string) {
    start(async () => {
      const res = await deleteSkuAlias(id, companyId);
      if (!res.ok) setMsg({ kind: "err", text: res.error ?? "ลบไม่สำเร็จ" });
    });
  }

  const trackedCount = skus.filter((s) => local[s.id]?.stockTracked ?? s.stockTracked).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Sync card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <Boxes className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
          <h3 className="text-sm font-bold text-zinc-800">ดึงสินค้าจาก TRCloud</h3>
          <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
            {skus.length} SKU · เก็บสต๊อก {trackedCount}
          </span>
        </div>
        <p className="mb-2 text-xs text-zinc-500">
          ดึงรายการสินค้าจาก TRCloud มาเก็บไว้ (ไม่สร้างใหม่) · ใส่คำค้น/หมวด เช่น “OIL” “H_S” หรือเว้นว่างเพื่อดึงทั้งหมด
        </p>
        <div className="flex gap-2">
          <input
            value={syncKeyword}
            onChange={(e) => setSyncKeyword(e.target.value)}
            placeholder="คำค้น (เว้นว่าง=ทั้งหมด)"
            className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
          <button
            type="button"
            onClick={runSync}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            ดึง/อัปเดต
          </button>
        </div>
      </div>

      {msg && (
        <p className={"text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")} role="status">
          {msg.text}
        </p>
      )}

      {/* Search within cached SKUs */}
      {skus.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา SKU / ชื่อสินค้า"
            className="h-10 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
        </div>
      )}

      {skus.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-500">
          ยังไม่มีสินค้าในระบบ — กด “ดึง/อัปเดต” ด้านบนเพื่อดึงจาก TRCloud
        </div>
      ) : (
        groups.map(([group, list]) => (
          <div key={group} className="rounded-2xl border border-zinc-100 bg-white p-3">
            <h4 className="mb-2 px-1 text-xs font-bold text-zinc-700">{group} · {list.length} รายการ</h4>
            <ul className="space-y-1.5">
              {list.map((s) => {
                const st = local[s.id]?.stockTracked ?? s.stockTracked;
                const pf = local[s.id]?.packFactor ?? s.packFactor;
                const myAliases = aliasBySku.get(s.id) ?? [];
                return (
                  <li key={s.id} className={"rounded-xl border p-2.5 " + (st ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-200")}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(s)}
                        disabled={pending}
                        aria-pressed={st}
                        className={"inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium " +
                          (st ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-zinc-200 bg-white text-zinc-500")}
                      >
                        {st && <Check className="size-3" />}
                        {st ? "เก็บสต๊อก" : "ไม่เก็บ"}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-800">
                          {s.productName || s.productId}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {s.productId}{s.unit ? ` · ${s.unit}` : ""}{s.balance != null ? ` · คงเหลือ ${s.balance.toLocaleString()}` : ""}
                        </p>
                      </div>
                    </div>
                    {st && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-1">
                        <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                          1 แพ็ค =
                          <input
                            type="number"
                            min={1}
                            defaultValue={pf}
                            onBlur={(e) => savePack(s, e.target.value)}
                            className="h-7 w-16 rounded border border-zinc-200 px-1.5 text-center text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
                          />
                          {s.unit || "ชิ้น"}
                        </label>
                        {myAliases.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-zinc-400">ชื่อบนใบเสร็จ:</span>
                            {myAliases.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => delAlias(a.id)}
                                title="กดเพื่อลบการจับคู่นี้"
                                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 hover:bg-rose-50 hover:text-rose-600"
                              >
                                {a.aliasKey} ✕
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <p className="px-1 text-[11px] text-zinc-400">
        การจับคู่ “ชื่อบนใบเสร็จ → SKU” จะเพิ่มอัตโนมัติตอนรับเข้าคลังครั้งแรก (ระบบจะถามให้จับคู่) · ที่นี่ดู/ลบได้
      </p>
    </div>
  );
}
