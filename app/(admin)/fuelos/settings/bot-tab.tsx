"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { Plus, Bot, Pencil, Power } from "lucide-react";
import { formatNumber } from "@/lib/fuelos/utils/format";
import { upsertFaq, toggleFaq } from "./actions";
import type { SettingsFaq } from "@/lib/fuelos/settings-data";

export function BotTab({ faqs }: { faqs: SettingsFaq[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SettingsFaq | "new" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    start(async () => {
      const res = await upsertFaq(formData);
      if (res.ok) {
        toast.success("บันทึกคำตอบแล้ว");
        formRef.current?.reset();
        setEditing(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  function onToggle(id: string, next: boolean) {
    start(async () => {
      const res = await toggleFaq(id, next);
      if (res.ok) { toast.success(next ? "เปิดใช้งานคำตอบแล้ว" : "ปิดคำตอบแล้ว"); router.refresh(); }
      else toast.error(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }

  const edit = editing && editing !== "new" ? editing : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-bold">บอท FAQ <span className="text-zinc-400 font-normal">({faqs.length})</span></h2>
        <Button size="sm" className="ml-auto" onClick={() => setEditing(editing === "new" ? null : "new")}>
          <Plus className="size-4" /> เพิ่มคำตอบ
        </Button>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">
        เมื่อลูกค้าพิมพ์คำที่ตรงกับ &quot;คำค้น&quot; บอทจะตอบข้อความนี้อัตโนมัติ — ลำดับสูงกว่าจะถูกเลือกก่อน
      </p>

      {editing && (
        <form ref={formRef} action={onSubmit} className="rounded-2xl border border-border bg-surface p-4 space-y-3">
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="text-xs text-zinc-500">คำค้น (คั่นด้วยจุลภาค)</label>
              <input name="keywords" required defaultValue={edit?.keywords ?? ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="ราคา, เท่าไหร่, สอบถามราคา" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">ลำดับ</label>
              <input name="priority" type="number" defaultValue={edit?.priority ?? 0} className="mt-1 h-10 w-24 rounded-xl border border-border bg-surface px-3 text-sm text-right tabular-nums" />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500">คำตอบ</label>
            <textarea name="answer" required rows={3} defaultValue={edit?.answer ?? ""} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm" placeholder="ราคาน้ำมันวันนี้ดูได้ที่... สอบถามเพิ่มเติมได้เลยครับ" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>ยกเลิก</Button>
            <Button type="submit" loading={pending}>{edit ? "บันทึกการแก้ไข" : "เพิ่มคำตอบ"}</Button>
          </div>
        </form>
      )}

      <div className="grid gap-2">
        {faqs.length === 0 && <div className="text-center text-zinc-400 py-10 text-sm">ยังไม่มีคำตอบอัตโนมัติ</div>}
        {faqs.map((f) => (
          <div key={f.id} className={cn("rounded-2xl border border-border bg-surface p-3.5", !f.enabled && "opacity-60")}>
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-xl bg-info/10 text-info grid place-items-center shrink-0"><Bot className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {f.keywords.split(",").map((k, i) => k.trim() && (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 border border-border text-zinc-600">{k.trim()}</span>
                  ))}
                  <span className="text-[10px] text-zinc-400 ml-1">ลำดับ {f.priority} · ใช้ไป {formatNumber(f.hits)} ครั้ง</span>
                </div>
                <p className="text-sm text-zinc-600 mt-1.5 whitespace-pre-wrap line-clamp-3">{f.answer}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onToggle(f.id, !f.enabled)}
                  disabled={pending}
                  title={f.enabled ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  className={cn("size-8 grid place-items-center rounded-lg border border-border", f.enabled ? "text-leaf-600" : "text-zinc-400")}
                >
                  <Power className="size-4" />
                </button>
                <button onClick={() => setEditing(f)} disabled={pending} className="size-8 grid place-items-center rounded-lg border border-border text-zinc-500" title="แก้ไข">
                  <Pencil className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
