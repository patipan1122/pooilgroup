"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { bkkDate } from "@/lib/fuelos/utils/format";
import { updateCustomer, addFollowUp, doneFollowUp } from "../actions";
import { Check, Plus } from "lucide-react";

type FU = { id: string; note: string; dueDate: Date | string; kind: string };

export function CustomerEditor({
  id, initialNotes, initialCadence, followUps,
}: {
  id: string; initialNotes: string; initialCadence: number | null; followUps: FU[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [cadence, setCadence] = useState(initialCadence?.toString() ?? "");
  const [fuNote, setFuNote] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold mb-2 text-sm">รอบซื้อปกติ + โน้ต</h3>
        <div className="flex items-center gap-2 mb-3">
          <input value={cadence} onChange={(e) => setCadence(e.target.value)} type="number" placeholder="วัน"
            className="h-9 w-24 rounded-lg border border-border bg-surface px-3 text-sm" />
          <span className="text-sm text-zinc-500">วัน/รอบ</span>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="โน้ตเกี่ยวกับลูกค้า…"
          className="w-full rounded-xl border border-border bg-surface p-3 text-sm resize-none" />
        <Button size="sm" className="mt-2" loading={pending}
          onClick={() => start(async () => { await updateCustomer(id, { notes, cadence: cadence ? Number(cadence) : null }); toast.success("บันทึกแล้ว"); router.refresh(); })}>
          บันทึก
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold mb-2 text-sm">งานติดตาม (Follow-up)</h3>
        <div className="space-y-1.5 mb-3">
          {followUps.length === 0 && <div className="text-xs text-zinc-400">ไม่มีงานค้าง</div>}
          {followUps.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm">
              <button onClick={() => start(async () => { await doneFollowUp(f.id, id); router.refresh(); })} disabled={pending}
                className="size-5 rounded-md border border-border hover:bg-leaf-100 grid place-items-center shrink-0">
                <Check className="size-3 text-leaf-600" />
              </button>
              <span className="flex-1">{f.note}</span>
              <span className="text-[11px] text-zinc-400">{bkkDate(f.dueDate)}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="งานติดตาม…" className="flex-1 h-9 rounded-lg border border-border bg-surface px-3 text-sm" />
          <input value={fuDate} onChange={(e) => setFuDate(e.target.value)} type="date" className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" />
          <button disabled={!fuNote || !fuDate || pending}
            onClick={() => start(async () => { await addFollowUp(id, fuNote, fuDate); setFuNote(""); setFuDate(""); toast.success("เพิ่มงานติดตาม"); router.refresh(); })}
            className="size-9 grid place-items-center rounded-lg bg-brand-600 text-white shrink-0 disabled:opacity-40"><Plus className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}
