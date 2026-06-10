"use client";

// BranchInventoryManager — หน้า "สอนระบบ" แบบเลือกสาขาก่อน (LEDGER_STOCKIN_V1).
//
// จังหวะการใช้งานตามที่ CEO ออกแบบ:
//   ① เลือกสาขา → ② ใส่ว่าสาขานี้ขายสินค้าอะไร (ดึง SKU จาก TRCloud เข้าสาขา)
//   → ③ พิมพ์ชื่อบนใบเสร็จ "สอน" ให้ระบบจำว่า "ชื่อนี้ = สินค้านี้".
// ชื่อที่สอนใช้ร่วมทั้งบริษัท (ชื่อเดียว=สินค้าเดียว) · สาขา = กรองลิสต์ + กันคีย์ผิดสาขา.
// TRCloud นับสต๊อกก้อนเดียวต่อสินค้า — ไม่ได้แยกยอดรายสาขา.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Store, Search, Plus, Check, Loader2, Boxes, Tag, X, Save, AlertTriangle,
} from "lucide-react";
import type { PackUnit } from "@/lib/ledger/sku-match";
import {
  setSkuBranchLink,
  toggleSkuStockTracked,
  setSkuPackUnits,
  mapSkuAlias,
  deleteSkuAlias,
} from "../../_stockin-actions";

export type Branch = { id: string; name: string; code: string; businessType: string };
export type Sku = {
  id: string;
  productId: string;
  productName: string | null;
  businessGroup: string | null;
  unit: string | null;
  status: string | null;
  stockTracked: boolean;
  packUnits: PackUnit[];
  balance: number | null;
  branchIds: string[];
};
export type Alias = { id: string; aliasKey: string; skuId: string; source: string };

export function BranchInventoryManager({
  companyId,
  branches,
  skus,
  aliases,
}: {
  companyId: string;
  branches: Branch[];
  skus: Sku[];
  aliases: Alias[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [addQuery, setAddQuery] = useState("");

  const aliasesBySku = useMemo(() => {
    const m = new Map<string, Alias[]>();
    for (const a of aliases) (m.get(a.skuId) ?? m.set(a.skuId, []).get(a.skuId)!).push(a);
    return m;
  }, [aliases]);

  const linkedSkus = useMemo(
    () => skus.filter((s) => s.branchIds.includes(branchId)),
    [skus, branchId],
  );
  const addCandidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return skus
      .filter((s) => !s.branchIds.includes(branchId))
      .filter((s) => !q || s.productId.toLowerCase().includes(q) || (s.productName ?? "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [skus, branchId, addQuery]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (okText) setMsg({ kind: "ok", text: okText });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ทำรายการไม่สำเร็จ" });
      }
    });
  }

  if (branches.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-500">
        ยังไม่มีสาขาในบริษัทนี้ — เพิ่มสาขาที่ ตั้งค่า → สาขา ก่อน
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* ① เลือกสาขา */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <label className="mb-1.5 flex items-center gap-2 text-sm font-bold text-zinc-800">
          <Store className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden /> ① เลือกสาขา
        </label>
        <select
          value={branchId}
          onChange={(e) => { setBranchId(e.target.value); setAddQuery(""); setMsg(null); }}
          aria-label="เลือกสาขา"
          className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ""}</option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          เลือกสาขา แล้วใส่ว่าสาขานี้ขายสินค้าอะไร · ชื่อบนใบเสร็จที่สอน จะใช้ได้ทุกสาขา (ชื่อเดียว = สินค้าเดียว)
        </p>
      </div>

      {msg && (
        <p className={"text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")} role="status">
          {msg.text}
        </p>
      )}

      {/* ② เพิ่มสินค้าจาก TRCloud เข้าสาขานี้ */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-800">
          <Plus className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden /> ② เพิ่มสินค้าจาก TRCloud เข้าสาขานี้
        </h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            placeholder="ค้นรหัส/ชื่อสินค้าใน TRCloud เช่น OIL, น้ำมัน, เบียร์"
            className="h-11 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
        </div>
        {addQuery.trim() && (
          <ul className="mt-2 space-y-1">
            {addCandidates.length === 0 ? (
              <li className="px-1 py-2 text-xs text-zinc-500">ไม่พบสินค้า (ถ้ายังไม่ดึงจาก TRCloud — ไปกด “ดึง/อัปเดต” ที่หัวข้อด้านล่าง)</li>
            ) : (
              addCandidates.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50/60 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800">{s.productName || s.productId}</p>
                    <p className="font-mono text-[11px] text-zinc-500">{s.productId}{s.businessGroup ? ` · ${s.businessGroup}` : ""}</p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => setSkuBranchLink(s.id, companyId, branchId, true), `เพิ่ม ${s.productId} เข้าสาขาแล้ว`)}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Plus className="size-3.5" /> เพิ่ม
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* ③ สินค้าที่สาขานี้ใช้ + สอนชื่อ */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-bold text-zinc-800">
          <Boxes className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden /> ③ สินค้าที่สาขานี้ใช้
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{linkedSkus.length}</span>
        </h3>
        {linkedSkus.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-500">
            ยังไม่มีสินค้าในสาขานี้ — ใช้ช่อง “② เพิ่มสินค้าจาก TRCloud” ด้านบน
          </div>
        ) : (
          <ul className="space-y-2.5">
            {linkedSkus.map((s) => (
              <SkuCard
                key={s.id}
                sku={s}
                companyId={companyId}
                branchId={branchId}
                aliases={aliasesBySku.get(s.id) ?? []}
                pending={pending}
                run={run}
                onError={(t) => setMsg({ kind: "err", text: t })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkuCard({
  sku, companyId, branchId, aliases, pending, run, onError,
}: {
  sku: Sku;
  companyId: string;
  branchId: string;
  aliases: Alias[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) => void;
  onError: (text: string) => void;
}) {
  const [, startLocal] = useTransition();
  const [units, setUnits] = useState<PackUnit[]>(sku.packUnits);
  const [unitsDirty, setUnitsDirty] = useState(false);
  const [aliasText, setAliasText] = useState("");
  const [conflict, setConflict] = useState<{ text: string; existing: string } | null>(null);

  function updateUnit(i: number, patch: Partial<PackUnit>) {
    setUnits((u) => u.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    setUnitsDirty(true);
  }
  function addUnit() { setUnits((u) => [...u, { name: "", factor: 0 }]); setUnitsDirty(true); }
  function removeUnit(i: number) { setUnits((u) => u.filter((_, idx) => idx !== i)); setUnitsDirty(true); }
  function saveUnits() {
    const clean = units.filter((u) => u.name.trim() && u.factor > 0);
    run(() => setSkuPackUnits(sku.id, companyId, clean), "บันทึกหน่วยแล้ว");
    setUnitsDirty(false);
  }

  function teach(force = false) {
    const text = aliasText.trim();
    if (!text) return;
    startLocal(async () => {
      const res = await mapSkuAlias(companyId, text, sku.id, force);
      if (res.ok) {
        setAliasText("");
        setConflict(null);
        run(async () => ({ ok: true }), `สอนแล้ว: “${text}” = ${sku.productId}`);
      } else if (res.conflict) {
        setConflict({ text, existing: res.conflict.existingProductId });
      } else {
        onError(res.error ?? "สอนไม่สำเร็จ");
      }
    });
  }

  return (
    <li className={"rounded-2xl border bg-white p-3 " + (sku.stockTracked ? "border-emerald-200" : "border-zinc-200")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-800">{sku.productName || sku.productId}</p>
          <p className="font-mono text-[11px] text-zinc-500">
            {sku.productId}{sku.unit ? ` · ${sku.unit}` : ""}{sku.balance != null ? ` · คงเหลือ ${sku.balance.toLocaleString()}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => toggleSkuStockTracked(sku.id, companyId, !sku.stockTracked))}
          aria-pressed={sku.stockTracked}
          className={"inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium " +
            (sku.stockTracked ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-zinc-200 bg-white text-zinc-500")}
        >
          {sku.stockTracked && <Check className="size-3" />}{sku.stockTracked ? "เก็บสต๊อก" : "ไม่เก็บ"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setSkuBranchLink(sku.id, companyId, branchId, false), "เอาออกจากสาขาแล้ว")}
          title="เอาสินค้านี้ออกจากสาขานี้"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-rose-50 hover:text-rose-600"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* หน่วยซื้อ (หลายหน่วย) */}
      <div className="mt-2.5 rounded-xl border border-zinc-100 bg-zinc-50/60 p-2.5">
        <p className="mb-1.5 text-[11px] font-medium text-zinc-500">หน่วยตอนซื้อ (1 หน่วย = กี่{sku.unit || "ชิ้น"})</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {units.map((u, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-1.5 py-1">
              <input
                value={u.name}
                onChange={(e) => updateUnit(i, { name: e.target.value })}
                placeholder="ชื่อ เช่น ลัง"
                className="h-6 w-16 rounded border-0 px-1 text-xs outline-none focus:ring-1 focus:ring-[var(--color-brand-200)]"
              />
              <span className="text-[11px] text-zinc-500">=</span>
              <input
                type="number"
                min={1}
                value={u.factor || ""}
                onChange={(e) => updateUnit(i, { factor: Number(e.target.value) })}
                placeholder="จำนวน"
                className="h-6 w-14 rounded border-0 px-1 text-center text-xs outline-none focus:ring-1 focus:ring-[var(--color-brand-200)]"
              />
              <button type="button" aria-label="ลบหน่วยนี้" onClick={() => removeUnit(i)} className="text-zinc-300 hover:text-rose-500"><X className="size-3.5" /></button>
            </span>
          ))}
          <button type="button" onClick={addUnit} className="inline-flex h-7 items-center gap-1 rounded-lg border border-dashed border-zinc-300 px-2 text-[11px] text-zinc-500 hover:bg-white">
            <Plus className="size-3" /> เพิ่มหน่วย
          </button>
          {unitsDirty && (
            <button type="button" disabled={pending} onClick={saveUnits} className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} บันทึกหน่วย
            </button>
          )}
        </div>
      </div>

      {/* สอนชื่อบนใบเสร็จ */}
      <div className="mt-2.5">
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-zinc-500">
          <Tag className="size-3.5" /> ชื่อบนใบเสร็จที่สอนแล้ว
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {aliases.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteSkuAlias(a.id, companyId))}
              title="กดเพื่อลบ"
              className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] hover:bg-rose-50 hover:text-rose-600 " +
                (a.source === "auto" ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-600")}
            >
              {a.aliasKey} <X className="size-3" />
            </button>
          ))}
          {aliases.length === 0 && <span className="text-[11px] text-zinc-500">ยังไม่มี — พิมพ์สอนด้านล่าง</span>}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={aliasText}
            onChange={(e) => { setAliasText(e.target.value); setConflict(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); teach(false); } }}
            placeholder="พิมพ์ชื่อที่เจอบนบิล แล้วกดสอน"
            className="h-9 flex-1 rounded-lg border border-zinc-200 px-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
          <button
            type="button"
            disabled={pending || !aliasText.trim()}
            onClick={() => teach(false)}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Plus className="size-4" /> สอน
          </button>
        </div>
        {conflict && (
          <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
            <p className="flex items-center gap-1"><AlertTriangle className="size-3.5" /> “{conflict.text}” ผูกกับ {conflict.existing} อยู่แล้ว</p>
            <div className="mt-1.5 flex gap-2">
              <button type="button" onClick={() => teach(true)} className="rounded-md bg-amber-600 px-2 py-1 font-semibold text-white">ย้ายมาที่ {sku.productId}</button>
              <button type="button" onClick={() => setConflict(null)} className="rounded-md border border-amber-300 px-2 py-1">ยกเลิก</button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
