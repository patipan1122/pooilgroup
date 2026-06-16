"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tag, Check } from "lucide-react";
import { toggleConvLabel } from "@/app/(admin)/fuelos/inbox/actions";
import { labelTone } from "@/components/fuelos/inbox/label-colors";
import { cn } from "@/lib/fuelos/utils/cn";

type Label = { id: string; name: string; color: string };

// ติด/ถอดป้ายให้แชทปัจจุบัน — ปุ่มเล็กบนหัวแชท กดเปิด popover เลือกป้าย
export function ConvLabelPicker({ convId, allLabels, activeIds }: { convId: string; allLabels: Label[]; activeIds: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [active, setActive] = useState<Set<string>>(new Set(activeIds));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setActive(new Set(activeIds)); }, [activeIds]);

  // ปิด popover เมื่อคลิกนอกกรอบ
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle(id: string) {
    const on = !active.has(id);
    // optimistic
    setActive((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
    start(async () => {
      const r = await toggleConvLabel(convId, id, on);
      if (!r.ok) { toast.error(r.error ?? "ไม่สำเร็จ"); setActive((prev) => { const next = new Set(prev); if (on) next.delete(id); else next.add(id); return next; }); }
      else router.refresh();
    });
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border text-xs text-zinc-600 hover:bg-surface-2"
        title="ติดป้าย/หมวดหมู่"
      >
        <Tag className="size-4" /> ป้าย
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-xl border border-border bg-surface shadow-xl p-1.5">
          {allLabels.length === 0 ? (
            <div className="text-xs text-zinc-400 p-2.5">ยังไม่มีป้าย — สร้างที่ปุ่ม “จัดการป้าย” ในรายการแชท</div>
          ) : (
            allLabels.map((l) => {
              const on = active.has(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => toggle(l.id)}
                  disabled={pending}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 text-left"
                >
                  <span className={cn("size-2.5 rounded-full shrink-0", labelTone(l.color).dot)} />
                  <span className="text-sm flex-1 truncate">{l.name}</span>
                  {on && <Check className="size-4 text-brand-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
