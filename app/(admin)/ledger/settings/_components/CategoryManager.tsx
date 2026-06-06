"use client";

// จัดการหมวดค่าใช้จ่าย — เพิ่มใหม่ + เปิด/ปิดใช้งาน + ผูก GL + SKU + VAT claimable
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createCategory, toggleCategory, updateCategoryTrcloud } from "../../_actions";
import { LedgerEmptyState } from "@/components/ledger/Brand";

const SKUS = [
  { value: "", label: "— เลือก SKU —" },
  { value: "JPS-100", label: "JPS-100 · สินค้าทั่วไป" },
  { value: "JPS-101", label: "JPS-101 · ซื้อบริการ" },
  { value: "JPS-103", label: "JPS-103 · วัสดุก่อสร้าง" },
];

type Cat = {
  id: string;
  name: string;
  color: string | null;
  trcloudAccCode: string | null;
  trcloudProductCode: string | null;
  vatClaimable: boolean;
  sort: number;
  active: boolean;
};

type EditState = {
  trcloudAccCode: string;
  trcloudProductCode: string;
  vatClaimable: boolean;
};

export function CategoryManager({
  companyId,
  categories,
}: {
  companyId: string;
  categories: Cat[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", trcloudAccCode: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    trcloudAccCode: "",
    trcloudProductCode: "",
    vatClaimable: true,
  });

  const input =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  function startEdit(c: Cat) {
    setEditingId(c.id);
    setEditState({
      trcloudAccCode: c.trcloudAccCode ?? "",
      trcloudProductCode: c.trcloudProductCode ?? "",
      vatClaimable: c.vatClaimable,
    });
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const res = await updateCategoryTrcloud({
        id,
        trcloudAccCode: editState.trcloudAccCode,
        trcloudProductCode: editState.trcloudProductCode,
        vatClaimable: editState.vatClaimable,
      });
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        setMsg(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  function add() {
    if (!form.name.trim()) return;
    setMsg(null);
    startTransition(async () => {
      const res = await createCategory({
        companyId,
        name: form.name.trim(),
        trcloudAccCode: form.trcloudAccCode.trim(),
      });
      if (res.ok) {
        setForm({ name: "", trcloudAccCode: "" });
        router.refresh();
      } else {
        setMsg(res.error ?? "เพิ่มไม่สำเร็จ");
      }
    });
  }

  function toggle(id: string, active: boolean) {
    startTransition(async () => {
      await toggleCategory(id, active);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-bold text-zinc-800">หมวดค่าใช้จ่าย</h2>

      {/* Add form */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          className={`${input} flex-1`}
          placeholder="ชื่อหมวด เช่น ค่าน้ำมัน/ขนส่ง"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className={`${input} sm:w-36`}
          placeholder="รหัสบัญชี GL"
          value={form.trcloudAccCode}
          onChange={(e) => setForm({ ...form, trcloudAccCode: e.target.value })}
        />
        <Button variant="primary" disabled={pending || !form.name.trim()} onClick={add}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          เพิ่ม
        </Button>
      </div>
      {msg && <p className="mb-2 text-xs text-rose-600">{msg}</p>}

      {/* List */}
      {categories.length === 0 ? (
        <LedgerEmptyState
          mascotSize={48}
          className="py-6"
          title="ยังไม่มีหมวด"
          hint="เพิ่มหมวดแรกด้านบน เช่น ค่าน้ำมัน/ขนส่ง"
        />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {categories.map((c) => (
            <li key={c.id} className="py-2.5">
              {editingId === c.id ? (
                /* Inline edit row */
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-zinc-800">{c.name}</span>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className={`${input} w-32`}
                      placeholder="GL code"
                      value={editState.trcloudAccCode}
                      onChange={(e) =>
                        setEditState({ ...editState, trcloudAccCode: e.target.value })
                      }
                    />
                    <select
                      aria-label="SKU สินค้า TRCloud"
                      className={`${input} w-52`}
                      value={editState.trcloudProductCode}
                      onChange={(e) =>
                        setEditState({ ...editState, trcloudProductCode: e.target.value })
                      }
                    >
                      {SKUS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={editState.vatClaimable}
                        onChange={(e) =>
                          setEditState({ ...editState, vatClaimable: e.target.checked })
                        }
                      />
                      VAT ขอคืนได้
                    </label>
                    <button
                      type="button"
                      onClick={() => saveEdit(c.id)}
                      disabled={pending}
                      className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Check className="size-3" /> บันทึก
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={pending}
                      className="flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
                    >
                      <X className="size-3" /> ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                /* Display row */
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-zinc-800">{c.name}</span>
                    {c.trcloudAccCode && (
                      <Badge tone="info" className="ml-2 font-mono text-[10px]">
                        {c.trcloudAccCode}
                      </Badge>
                    )}
                    {c.trcloudProductCode && (
                      <Badge tone="neutral" className="ml-1 font-mono text-[10px]">
                        {c.trcloudProductCode}
                      </Badge>
                    )}
                    {!c.vatClaimable && (
                      <Badge tone="warning" className="ml-1 text-[10px]">
                        VAT ขอคืนไม่ได้
                      </Badge>
                    )}
                    {!c.active && (
                      <Badge tone="neutral" className="ml-2 text-[10px]">
                        ปิดใช้งาน
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      disabled={pending}
                      className="text-xs font-medium text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                      title="แก้ไข GL/SKU"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(c.id, !c.active)}
                      disabled={pending}
                      className="text-xs font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
                    >
                      {c.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
