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
  const [form, setForm] = useState({ name: "", trcloudAccCode: "", trcloudProductCode: "", vatClaimable: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    trcloudAccCode: "",
    trcloudProductCode: "",
    vatClaimable: true,
  });
  const [accCodeError, setAccCodeError] = useState<string | null>(null);

  const input =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  function startEdit(c: Cat) {
    setEditingId(c.id);
    setAccCodeError(null);
    setEditState({
      trcloudAccCode: c.trcloudAccCode ?? "",
      trcloudProductCode: c.trcloudProductCode ?? "",
      vatClaimable: c.vatClaimable,
    });
  }

  function saveEdit(id: string) {
    // Validate GL code: must be exactly 7 digits if provided
    const code = editState.trcloudAccCode.trim();
    if (code && !/^[0-9]{7}$/.test(code)) {
      setAccCodeError("รหัสบัญชีต้องเป็นตัวเลข 7 หลัก เช่น 5101001");
      return;
    }
    setAccCodeError(null);
    startTransition(async () => {
      const res = await updateCategoryTrcloud({
        id,
        trcloudAccCode: code,
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
    const code = form.trcloudAccCode.trim();
    if (code && !/^[0-9]{7}$/.test(code)) {
      setMsg("รหัสบัญชีต้องเป็นตัวเลข 7 หลัก เช่น 5101001");
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await createCategory({
        companyId,
        name: form.name.trim(),
        trcloudAccCode: code,
        trcloudProductCode: form.trcloudProductCode,
        vatClaimable: form.vatClaimable,
      });
      if (res.ok) {
        setForm({ name: "", trcloudAccCode: "", trcloudProductCode: "", vatClaimable: false });
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
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={`${input} flex-1`}
            placeholder="ชื่อหมวด เช่น ค่าน้ำมัน/ขนส่ง"
            value={form.name}
            onChange={(e) => { setMsg(null); setForm({ ...form, name: e.target.value }); }}
          />
          <input
            className={`${input} sm:w-36`}
            placeholder="รหัสบัญชี GL (7 หลัก)"
            value={form.trcloudAccCode}
            onChange={(e) => { setMsg(null); setForm({ ...form, trcloudAccCode: e.target.value }); }}
          />
          <select
            aria-label="SKU TRCloud"
            className={`${input} sm:w-44`}
            value={form.trcloudProductCode}
            onChange={(e) => setForm({ ...form, trcloudProductCode: e.target.value })}
          >
            {SKUS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
            <input
              type="checkbox"
              className="rounded"
              checked={form.vatClaimable}
              onChange={(e) => setForm({ ...form, vatClaimable: e.target.checked })}
            />
            <span>VAT ขอคืนได้ <span className="text-zinc-400">(เปิดถ้ามีใบกำกับภาษีแบบเต็มจากผู้ขายจด VAT)</span></span>
          </label>
          <Button variant="primary" disabled={pending || !form.name.trim()} onClick={add}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            เพิ่ม
          </Button>
        </div>
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
                /* Expanded edit panel — bordered card below the row */
                <div className="rounded-xl border border-[var(--color-brand-200,theme(colors.violet.200))] bg-zinc-50 p-3">
                  {/* Panel header */}
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-800">{c.name}</span>
                    <button
                      type="button"
                      aria-label="ปิดแก้ไข"
                      onClick={() => { setEditingId(null); setAccCodeError(null); }}
                      disabled={pending}
                      className="rounded-md p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  {/* Fields grid — 2-col on sm+ */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {/* GL code */}
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-600">
                        รหัสบัญชี GL
                      </label>
                      <input
                        className={`${input} w-full ${accCodeError ? "border-rose-400 focus:ring-rose-300" : ""}`}
                        placeholder="7 หลัก เช่น 5101001"
                        value={editState.trcloudAccCode}
                        onChange={(e) => {
                          setAccCodeError(null);
                          setEditState({ ...editState, trcloudAccCode: e.target.value });
                        }}
                      />
                      {accCodeError ? (
                        <p className="mt-0.5 text-[10px] text-rose-600">{accCodeError}</p>
                      ) : (
                        <p className="mt-0.5 text-[10px] text-zinc-400">ตัวเลข 7 หลักจาก TRCloud ผังบัญชี</p>
                      )}
                    </div>

                    {/* SKU select — option labels include description; hint echoes selection */}
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-600">
                        SKU สินค้า TRCloud
                      </label>
                      <select
                        aria-label="SKU สินค้า TRCloud"
                        className={`${input} w-full`}
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
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        {editState.trcloudProductCode
                          ? (SKUS.find((s) => s.value === editState.trcloudProductCode)?.label ?? "")
                          : "เลือก SKU ที่ตรงกับประเภทค่าใช้จ่าย"}
                      </p>
                    </div>
                  </div>

                  {/* VAT checkbox */}
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={editState.vatClaimable}
                      onChange={(e) =>
                        setEditState({ ...editState, vatClaimable: e.target.checked })
                      }
                    />
                    <span>
                      VAT ขอคืนได้{" "}
                      <span className="text-zinc-400">(ปิดถ้าซื้อจากผู้ขายไม่จด VAT)</span>
                    </span>
                  </label>

                  {/* Action bar */}
                  <div className="mt-3 flex justify-end gap-2 border-t border-zinc-200 pt-3">
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setAccCodeError(null); }}
                      disabled={pending}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(c.id)}
                      disabled={pending}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {pending ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
                      บันทึก
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
                    {c.active && !c.trcloudAccCode && !c.trcloudProductCode && (
                      <Badge tone="warning" className="ml-1 text-[10px]">
                        ยังไม่ผูก TRCloud
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
                      aria-label="แก้ไข GL/SKU"
                      onClick={() => startEdit(c)}
                      disabled={pending}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50"
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
