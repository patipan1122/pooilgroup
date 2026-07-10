"use client";

// ProjectFormDialog — สร้าง/แก้ไขโครงการ (F2). โหมด create → createProjectAction(companyId,...) ·
// โหมด edit → updateProjectAction(id,...). bottom-sheet มือถือ / dialog เดสก์ท็อป (สำนวน kit).
// gate: render เฉพาะเมื่อ canManage (page ตัดสิน) — server action เป็น backstop สิทธิ์จริง.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus, Pencil } from "lucide-react";
import {
  createProjectAction,
  updateProjectAction,
} from "@/app/(admin)/ledger/_actions";

type Initial = {
  id: string;
  name: string;
  budgetTotal: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  note: string | null;
};

/** Date → YYYY-MM-DD (input[type=date] value). */
function toDateInput(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function ProjectFormDialog({
  companyId,
  mode,
  initial,
  trigger,
}: {
  companyId: string;
  mode: "create" | "edit";
  initial?: Initial;
  /** ปุ่มเปิด — ถ้าไม่ส่งมาใช้ปุ่มมาตรฐานตามโหมด. */
  trigger?: "button" | "link";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [budget, setBudget] = useState(
    initial?.budgetTotal != null ? String(initial.budgetTotal) : "",
  );
  const [startedAt, setStartedAt] = useState(toDateInput(initial?.startedAt ?? null));
  const [endedAt, setEndedAt] = useState(toDateInput(initial?.endedAt ?? null));
  const [note, setNote] = useState(initial?.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  function submit() {
    setErr(null);
    if (!name.trim()) {
      setErr("ใส่ชื่อโครงการก่อน");
      return;
    }
    const payload = {
      name: name.trim(),
      budgetTotal: budget.trim() ? Number(budget) : null,
      startedAt: startedAt || undefined,
      endedAt: endedAt || undefined,
      note: note.trim() || undefined,
    };
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createProjectAction(companyId, payload)
          : await updateProjectAction(initial!.id, payload);
      if (res.ok) {
        setOpen(false);
        if (mode === "create") {
          setName("");
          setBudget("");
          setStartedAt("");
          setEndedAt("");
          setNote("");
        }
        router.refresh();
      } else {
        setErr(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-[var(--color-brand-400)] focus:outline-none";
  const labelCls = "mb-1 block text-xs font-medium text-zinc-600";

  return (
    <>
      {mode === "create" ? (
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setOpen(true);
          }}
          className="press inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--color-brand-600)] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-700)]"
        >
          <Plus className="size-4" aria-hidden /> สร้างโครงการ
        </button>
      ) : trigger === "link" ? (
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setOpen(true);
          }}
          className="press inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)]"
        >
          <Pencil className="size-3.5" aria-hidden /> แก้ไข
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setOpen(true);
          }}
          className="press inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <Pencil className="size-4" aria-hidden /> แก้ไขโครงการ
        </button>
      )}

      {open && (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => {
            if (!pending) setOpen(false);
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={mode === "create" ? "สร้างโครงการ" : "แก้ไขโครงการ"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 p-4">
              <h3 className="text-sm font-bold text-zinc-900">
                {mode === "create" ? "สร้างโครงการใหม่" : "แก้ไขโครงการ"}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                aria-label="ปิด"
                className="press grid size-9 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className={labelCls}>ชื่อโครงการ *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น รีโนเวทสาขาสีลม"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls}>งบประมาณโครงการ (ไม่บังคับ)</label>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                  placeholder="เช่น 500000"
                  className={inputCls}
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  ใส่ไว้เพื่อดูแถบเทียบยอดจ่ายจริง — เว้นว่างได้
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>วันเริ่ม</label>
                  <input
                    type="date"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>วันจบ (คาด)</label>
                  <input
                    type="date"
                    value={endedAt}
                    onChange={(e) => setEndedAt(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>บันทึกย่อ (ไม่บังคับ)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="รายละเอียดสั้น ๆ"
                  className={`${inputCls} resize-none`}
                />
              </div>

              {err && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>
              )}
            </div>

            <div className="border-t border-zinc-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="press flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-700)] disabled:bg-zinc-300"
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {mode === "create" ? "สร้างโครงการ" : "บันทึกการแก้ไข"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
