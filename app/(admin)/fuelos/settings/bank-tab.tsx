"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { Plus, Landmark, Pencil, Trash2, Star } from "lucide-react";
import { upsertBank, deleteBank } from "./actions";
import type { SettingsBank } from "@/lib/fuelos/settings-data";

export function BankTab({ banks }: { banks: SettingsBank[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SettingsBank | "new" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    start(async () => {
      const res = await upsertBank(formData);
      if (res.ok) {
        toast.success("บันทึกบัญชีแล้ว");
        formRef.current?.reset();
        setEditing(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  function onDelete(id: string) {
    if (!confirm("ลบบัญชีนี้?")) return;
    start(async () => {
      const res = await deleteBank(id);
      if (res.ok) { toast.success("ลบบัญชีแล้ว"); router.refresh(); }
      else toast.error(res.error ?? "ลบไม่สำเร็จ");
    });
  }

  const edit = editing && editing !== "new" ? editing : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-bold">บัญชีธนาคาร <span className="text-zinc-400 font-normal">({banks.length})</span></h2>
        <Button size="sm" className="ml-auto" onClick={() => setEditing(editing === "new" ? null : "new")}>
          <Plus className="size-4" /> เพิ่มบัญชี
        </Button>
      </div>

      {editing && (
        <form ref={formRef} action={onSubmit} className="rounded-2xl border border-border bg-surface p-4 grid sm:grid-cols-2 gap-3">
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div>
            <label className="text-xs text-zinc-500">ธนาคาร</label>
            <input name="bankName" required defaultValue={edit?.bankName ?? ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="เช่น กสิกรไทย" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">ชื่อบัญชี</label>
            <input name="accountName" required defaultValue={edit?.accountName ?? ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="ชื่อเจ้าของบัญชี" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">เลขบัญชี</label>
            <input name="accountNo" required defaultValue={edit?.accountNo ?? ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm font-[family-name:var(--font-plex-mono)]" placeholder="xxx-x-xxxxx-x" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer h-10">
              <input type="checkbox" name="isDefault" defaultChecked={edit?.isDefault ?? false} className="size-4 rounded border-border" />
              ตั้งเป็นบัญชีหลัก (ใช้ส่งให้ลูกค้าโอน)
            </label>
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>ยกเลิก</Button>
            <Button type="submit" loading={pending}>{edit ? "บันทึกการแก้ไข" : "เพิ่มบัญชี"}</Button>
          </div>
        </form>
      )}

      <div className="grid gap-2">
        {banks.length === 0 && <div className="text-center text-zinc-400 py-10 text-sm">ยังไม่มีบัญชีธนาคาร</div>}
        {banks.map((b) => (
          <div key={b.id} className="rounded-2xl border border-border bg-surface p-3.5 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-brand-100 text-brand-700 grid place-items-center shrink-0"><Landmark className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">{b.bankName}</span>
                {b.isDefault && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning"><Star className="size-3" />หลัก</span>}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 truncate">
                <span className="font-[family-name:var(--font-plex-mono)]">{b.accountNo}</span> · {b.accountName}
              </div>
            </div>
            <button onClick={() => setEditing(b)} disabled={pending} className="size-8 grid place-items-center rounded-lg border border-border text-zinc-500 shrink-0" title="แก้ไข">
              <Pencil className="size-4" />
            </button>
            <button onClick={() => onDelete(b.id)} disabled={pending} className={cn("size-8 grid place-items-center rounded-lg border border-border text-danger shrink-0")} title="ลบ">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
