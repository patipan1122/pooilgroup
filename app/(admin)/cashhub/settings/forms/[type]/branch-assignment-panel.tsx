"use client";

// Branch assignment panel — bulk assign สาขาให้ใช้ template version นี้
// แสดงในหน้า Form Editor ใต้ตัวเลือก version ปัจจุบัน
// Plan: fuel-doc-scalable-puppy.md · Issue 2

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface BranchOption {
  id: string;
  code: string;
  name: string;
  province: string | null;
  form_template_id: string | null;
}

interface Props {
  /** Template version ที่เปิดอยู่ตอนนี้ */
  activeTemplateId: string;
  isDefault: boolean;
  branches: BranchOption[];
}

export function BranchAssignmentPanel({
  activeTemplateId,
  isDefault,
  branches,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Initial selection = สาขาที่ form_template_id ตรงกับ template นี้
  // (สำหรับ default v1 — รวมสาขาที่ form_template_id = null ด้วย เพราะ runtime จะ fallback ไป default)
  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    for (const b of branches) {
      if (b.form_template_id === activeTemplateId) set.add(b.id);
      else if (isDefault && b.form_template_id === null) set.add(b.id);
    }
    return set;
  }, [branches, activeTemplateId, isDefault]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const dirty = useMemo(() => {
    if (selected.size !== initialSelected.size) return true;
    for (const id of selected) if (!initialSelected.has(id)) return true;
    return false;
  }, [selected, initialSelected]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(branches.map((b) => b.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function reset() {
    setSelected(new Set(initialSelected));
  }

  async function save() {
    // Compute diff
    const toAssign: string[] = [];
    const toUnassign: string[] = [];
    for (const b of branches) {
      const wasSelected = initialSelected.has(b.id);
      const nowSelected = selected.has(b.id);
      if (!wasSelected && nowSelected) toAssign.push(b.id);
      else if (wasSelected && !nowSelected) toUnassign.push(b.id);
    }

    if (toAssign.length === 0 && toUnassign.length === 0) return;

    startTransition(async () => {
      try {
        if (toAssign.length > 0) {
          const res = await fetch("/api/admin/branches/form-template", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              branchIds: toAssign,
              templateId: activeTemplateId,
            }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || "ผูกสาขาไม่สำเร็จ");
        }
        if (toUnassign.length > 0) {
          const res = await fetch("/api/admin/branches/form-template", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              branchIds: toUnassign,
              templateId: null, // ปลดออก → กลับไป fallback default
            }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || "ปลดสาขาไม่สำเร็จ");
        }
        toast.success(
          `อัปเดต ${toAssign.length + toUnassign.length} สาขาเรียบร้อย`,
        );
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "เกิดข้อผิดพลาด",
        );
      }
    });
  }

  if (branches.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-6 text-center">
        <Building2 className="size-6 mx-auto mb-2 text-zinc-400" />
        <p className="text-sm font-semibold text-zinc-700">
          ยังไม่มีสาขาในประเภทธุรกิจนี้
        </p>
        <p className="text-xs text-zinc-500 mt-1">
          เพิ่มสาขาในหน้า /branches แล้ว reload ที่นี่
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b-2 border-zinc-100 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm">สาขาที่ใช้เวอร์ชั่นนี้</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            ติ๊กสาขาที่ต้องการให้ใช้ฟอร์มเวอร์ชั่นนี้ · กดบันทึกเมื่อพร้อม
            {isDefault && (
              <>
                <span className="mx-1">·</span>
                <span className="text-[var(--color-brand-700)] font-semibold">
                  v1 = ค่าเริ่มต้น (สาขาที่ไม่ได้ผูกเวอร์ชั่น = ใช้ตัวนี้
                  อัตโนมัติ)
                </span>
              </>
            )}
          </p>
        </div>
        <span className="text-xs font-bold tabular-num text-[var(--color-brand-700)] shrink-0">
          {selected.size}/{branches.length}
        </span>
      </div>

      <div className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={selectAll}
          disabled={pending}
          className="text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] font-semibold"
        >
          เลือกทั้งหมด
        </button>
        <span className="text-zinc-300">·</span>
        <button
          type="button"
          onClick={selectNone}
          disabled={pending}
          className="text-zinc-600 hover:text-zinc-900 font-semibold"
        >
          ล้างทั้งหมด
        </button>
        {dirty && (
          <>
            <span className="text-zinc-300">·</span>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="text-zinc-600 hover:text-zinc-900 font-semibold"
            >
              คืนค่าเดิม
            </button>
          </>
        )}
      </div>

      <ul className="divide-y divide-zinc-100 max-h-80 overflow-y-auto">
        {branches.map((b) => {
          const isOn = selected.has(b.id);
          // โชว์เป็น badge ว่าตอนนี้สาขานี้ผูกกับ template ตัวอื่นอยู่ (ถ้ามี)
          const isOnOtherTpl =
            b.form_template_id !== null &&
            b.form_template_id !== activeTemplateId;
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => toggle(b.id)}
                disabled={pending}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 transition-colors text-left"
              >
                <div
                  className={cn(
                    "size-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                    isOn
                      ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)] text-white"
                      : "bg-white border-zinc-300",
                  )}
                >
                  {isOn && <Check className="size-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold tabular-num text-sm">{b.code}</div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {b.name}
                    {b.province && ` · ${b.province}`}
                  </div>
                </div>
                {isOnOtherTpl && !isOn && (
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md shrink-0">
                    ใช้เวอร์ชั่นอื่น
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {dirty && (
        <div className="px-4 py-3 border-t-2 border-zinc-100 bg-zinc-50/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="h-9 px-4 rounded-lg border-2 border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="h-9 px-5 rounded-lg bg-[var(--color-brand-600)] hover:bg-[var(--color-brand-700)] text-white text-sm font-bold shadow-blue inline-flex items-center gap-1.5 disabled:bg-zinc-300"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังบันทึก…
              </>
            ) : (
              <>บันทึก</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
