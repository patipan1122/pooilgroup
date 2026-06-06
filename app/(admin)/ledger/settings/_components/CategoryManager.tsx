"use client";

// จัดการหมวดค่าใช้จ่าย — เพิ่มใหม่ + เปิด/ปิดใช้งาน + แสดงรหัสบัญชี TRCloud.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createCategory, toggleCategory, updateCategory } from "../../_actions";
import { LedgerEmptyState } from "@/components/ledger/Brand";

type Cat = {
  id: string;
  name: string;
  color: string | null;
  trcloudAccCode: string | null;
  sort: number;
  active: boolean;
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

  // Inline edit — one category open at a time (id), with its draft fields.
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", color: "", trcloudAccCode: "" });
  const [editMsg, setEditMsg] = useState<string | null>(null);

  const input =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  function startEdit(c: Cat) {
    setEditMsg(null);
    setEditId(c.id);
    setEditForm({
      name: c.name,
      color: c.color ?? "",
      trcloudAccCode: c.trcloudAccCode ?? "",
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditMsg(null);
  }

  function saveEdit() {
    if (!editId || !editForm.name.trim()) return;
    setEditMsg(null);
    const id = editId;
    startTransition(async () => {
      const res = await updateCategory({
        id,
        name: editForm.name.trim(),
        color: editForm.color.trim(),
        trcloudAccCode: editForm.trcloudAccCode.trim(),
      });
      if (res.ok) {
        setEditId(null);
        router.refresh();
      } else {
        setEditMsg(res.error ?? "แก้ไขไม่สำเร็จ");
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
          className={`${input} sm:w-44`}
          placeholder="รหัสบัญชี TRCloud"
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
          {categories.map((c) =>
            editId === c.id ? (
              // Inline edit row
              <li key={c.id} className="rounded-lg bg-zinc-50 px-2.5 py-3">
                <div className="flex flex-col gap-2">
                  <input
                    className={`${input} w-full`}
                    placeholder="ชื่อหมวด"
                    aria-label="ชื่อหมวด"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 sm:w-32">
                      <span className="text-xs text-zinc-500">สี</span>
                      <input
                        type="color"
                        aria-label="สีของหมวด"
                        value={editForm.color || "#71717a"}
                        onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                        className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                    </label>
                    <input
                      className={`${input} flex-1`}
                      placeholder="รหัสบัญชี TRCloud"
                      aria-label="รหัสบัญชี TRCloud"
                      value={editForm.trcloudAccCode}
                      onChange={(e) => setEditForm({ ...editForm, trcloudAccCode: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={pending || !editForm.name.trim()}
                      onClick={saveEdit}
                    >
                      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      บันทึก
                    </Button>
                    <Button variant="outline" size="sm" disabled={pending} onClick={cancelEdit}>
                      <X className="size-4" />
                      ยกเลิก
                    </Button>
                  </div>
                  {editMsg && <p className="text-xs text-rose-600">{editMsg}</p>}
                </div>
              </li>
            ) : (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {c.color && (
                    <span
                      className="size-3 shrink-0 rounded-full border border-black/5"
                      style={{ backgroundColor: c.color }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate font-medium text-zinc-800">{c.name}</span>
                  {c.trcloudAccCode && (
                    <Badge tone="info" className="font-mono text-[10px]">
                      {c.trcloudAccCode}
                    </Badge>
                  )}
                  {!c.active && (
                    <Badge tone="neutral" className="text-[10px]">
                      ปิดใช้งาน
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    disabled={pending}
                    aria-label={`แก้ไขหมวด ${c.name}`}
                    title="แก้ไข"
                    className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    onClick={() => toggle(c.id, !c.active)}
                    disabled={pending}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
                  >
                    {c.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
