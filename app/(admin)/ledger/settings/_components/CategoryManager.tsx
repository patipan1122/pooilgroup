"use client";

// จัดการหมวดค่าใช้จ่าย — เพิ่มใหม่ + เปิด/ปิดใช้งาน + แสดงรหัสบัญชี TRCloud.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createCategory, toggleCategory } from "../../_actions";

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

  const input =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

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
        <p className="py-6 text-center text-sm text-zinc-400">ยังไม่มีหมวด</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <span className="font-medium text-zinc-800">{c.name}</span>
                {c.trcloudAccCode && (
                  <Badge tone="info" className="ml-2 font-mono text-[10px]">
                    {c.trcloudAccCode}
                  </Badge>
                )}
                {!c.active && (
                  <Badge tone="neutral" className="ml-2 text-[10px]">
                    ปิดใช้งาน
                  </Badge>
                )}
              </div>
              <button
                onClick={() => toggle(c.id, !c.active)}
                disabled={pending}
                className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
              >
                {c.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
