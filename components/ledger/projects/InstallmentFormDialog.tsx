"use client";

// InstallmentFormDialog — เพิ่ม/แก้ไขงวดงาน (F3). create → createInstallmentAction(projectId,...) ·
// edit → updateInstallmentAction(id,...). bottom-sheet มือถือ / dialog เดสก์ท็อป.
// gate: render เฉพาะ canManage · server backstop.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus, Pencil } from "lucide-react";
import {
  createInstallmentAction,
  updateInstallmentAction,
} from "@/app/(admin)/ledger/_actions";

type Initial = {
  id: string;
  seq: number;
  label: string;
  vendorLabel: string | null;
  dueDate: Date | null;
  plannedAmount: number;
};

function toDateInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export function InstallmentFormDialog({
  projectId,
  mode,
  initial,
  defaultVendorLabel,
}: {
  projectId: string;
  mode: "create" | "edit";
  initial?: Initial;
  /** เติมชื่อผู้รับเหมาให้อัตโนมัติเมื่อ "เพิ่มงวด" จากหัวกลุ่มผู้รับเหมา. */
  defaultVendorLabel?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [vendorLabel, setVendorLabel] = useState(
    initial?.vendorLabel ?? defaultVendorLabel ?? "",
  );
  const [dueDate, setDueDate] = useState(toDateInput(initial?.dueDate ?? null));
  const [plannedAmount, setPlannedAmount] = useState(
    initial?.plannedAmount != null ? String(initial.plannedAmount) : "",
  );
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
    if (!plannedAmount.trim() || Number.isNaN(Number(plannedAmount))) {
      setErr("ใส่ยอดสัญญาของงวดก่อน");
      return;
    }
    const payload = {
      label: label.trim() || undefined,
      vendorLabel: vendorLabel.trim() || null,
      dueDate: dueDate || undefined,
      plannedAmount: Number(plannedAmount),
    };
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createInstallmentAction(projectId, payload)
          : await updateInstallmentAction(initial!.id, payload);
      if (res.ok) {
        setOpen(false);
        if (mode === "create") {
          setLabel("");
          setDueDate("");
          setPlannedAmount("");
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
            setVendorLabel(initial?.vendorLabel ?? defaultVendorLabel ?? "");
            setErr(null);
            setOpen(true);
          }}
          className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-3 text-sm font-semibold text-[var(--color-brand-700)] transition-colors hover:bg-[var(--color-brand-100)]"
        >
          <Plus className="size-4" aria-hidden /> เพิ่มงวด
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setOpen(true);
          }}
          aria-label="แก้ไขงวด"
          className="press inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          <Pencil className="size-3.5" aria-hidden /> แก้ไข
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
            aria-label={mode === "create" ? "เพิ่มงวด" : "แก้ไขงวด"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 p-4">
              <h3 className="text-sm font-bold text-zinc-900">
                {mode === "create" ? "เพิ่มงวดงาน" : `แก้ไขงวด ${initial?.seq ?? ""}`}
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
                <label className={labelCls}>ยอดสัญญาของงวด *</label>
                <input
                  value={plannedAmount}
                  onChange={(e) => setPlannedAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="เช่น 150000"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls}>ชื่องวด (ไม่บังคับ)</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="เช่น งวดที่ 1 · วางเสาเข็ม"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>ผู้รับเหมา / ผู้ขาย (ไม่บังคับ)</label>
                <input
                  value={vendorLabel}
                  onChange={(e) => setVendorLabel(e.target.value)}
                  placeholder="เช่น หจก. ช่างสมชาย"
                  className={inputCls}
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  ใส่เพื่อจัดกลุ่มงวดตามผู้รับเหมา
                </p>
              </div>
              <div>
                <label className={labelCls}>กำหนดจ่าย (ไม่บังคับ)</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputCls}
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
                {mode === "create" ? "เพิ่มงวด" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
