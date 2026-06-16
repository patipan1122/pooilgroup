"use client";

import { useState, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tags, X, Plus, Trash2, Check } from "lucide-react";
import { createLabel, updateLabel, deleteLabel } from "@/app/(admin)/fuelos/inbox/actions";
import { LABEL_COLORS, labelTone } from "@/components/fuelos/inbox/label-colors";
import { cn } from "@/lib/fuelos/utils/cn";

type Label = { id: string; name: string; color: string; count: number };

function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`สี ${labelTone(c).name}`}
          className={cn("size-5 rounded-full border-2", labelTone(c).dot, value === c ? "border-zinc-900 scale-110" : "border-white/70")}
        />
      ))}
    </div>
  );
}

function LabelRow({ label }: { label: Label }) {
  const router = useRouter();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [pending, start] = useTransition();
  const dirty = name.trim() !== label.name || color !== label.color;

  function save() {
    start(async () => {
      const r = await updateLabel(label.id, { name, color });
      if (r.ok) { toast.success("บันทึกป้ายแล้ว"); router.refresh(); }
      else toast.error(r.error ?? "บันทึกไม่สำเร็จ");
    });
  }
  function remove() {
    if (!confirm(`ลบป้าย "${label.name}"? แชทที่ติดป้ายนี้จะถูกถอดป้ายออก (ตัวแชทไม่หาย)`)) return;
    start(async () => {
      const r = await deleteLabel(label.id);
      if (r.ok) { toast.success("ลบป้ายแล้ว"); router.refresh(); }
      else toast.error("ลบไม่สำเร็จ");
    });
  }

  return (
    <div className="flex items-center gap-2 py-2 border-b border-border last:border-0">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={cn("h-9 flex-1 min-w-0 rounded-lg border px-2.5 text-sm", labelTone(color).chip)}
      />
      <ColorDots value={color} onChange={setColor} />
      <span className="text-[11px] text-zinc-400 tabular-nums w-10 text-right shrink-0">{label.count} แชท</span>
      {dirty ? (
        <button onClick={save} disabled={pending} aria-label="บันทึก" className="size-9 grid place-items-center rounded-lg bg-brand-600 text-white shrink-0"><Check className="size-4" /></button>
      ) : (
        <button onClick={remove} disabled={pending} aria-label="ลบป้าย" className="size-9 grid place-items-center rounded-lg text-danger hover:bg-danger/10 shrink-0"><Trash2 className="size-4" /></button>
      )}
    </div>
  );
}

export function LabelManager({ labels }: { labels: Label[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("brand");
  const [pending, start] = useTransition();
  useEffect(() => { setMounted(true); }, []);

  function add() {
    const n = name.trim();
    if (!n) return;
    start(async () => {
      const r = await createLabel(n, color);
      if (r.ok) { toast.success("เพิ่มป้ายแล้ว"); setName(""); router.refresh(); }
      else toast.error(r.error ?? "เพิ่มไม่สำเร็จ");
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center gap-1 h-8 px-2 rounded-lg border border-border text-xs text-zinc-600 hover:bg-surface-2"
        title="จัดการป้าย/หมวดหมู่"
      >
        <Tags className="size-4" /> จัดการป้าย
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-surface shadow-xl flex flex-col max-h-[85vh]">
            <div className="shrink-0 flex items-center justify-between border-b border-border px-4 h-14">
              <h2 className="font-bold flex items-center gap-2"><Tags className="size-5 text-brand-600" /> ป้าย / หมวดหมู่แชท</h2>
              <button onClick={() => setOpen(false)} aria-label="ปิด" className="size-9 grid place-items-center rounded-lg hover:bg-surface-2"><X className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {/* สร้างใหม่ */}
              <div className="rounded-xl border border-border bg-surface-2 p-3 mb-3">
                <div className="text-xs font-semibold text-zinc-500 mb-1.5">เพิ่มป้ายใหม่</div>
                <div className="flex items-center gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                    placeholder="เช่น ซัพพลายเออร์ / ลูกค้า VIP / ราคา"
                    className="h-9 flex-1 min-w-0 rounded-lg border border-border bg-surface px-2.5 text-sm"
                  />
                  <button onClick={add} disabled={pending || !name.trim()} className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-brand-600 text-white text-xs disabled:opacity-50"><Plus className="size-4" /> เพิ่ม</button>
                </div>
                <div className="mt-2"><ColorDots value={color} onChange={setColor} /></div>
              </div>

              {/* รายการป้ายเดิม */}
              {labels.length === 0 ? (
                <div className="text-center text-sm text-zinc-400 py-6">ยังไม่มีป้าย — สร้างป้ายแรกด้านบน แล้วเอาไปติดแชทได้เลย</div>
              ) : (
                <div>{labels.map((l) => <LabelRow key={l.id} label={l} />)}</div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
