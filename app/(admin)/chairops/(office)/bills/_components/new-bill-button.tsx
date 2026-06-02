"use client";

// "+ บันทึกบิลใหม่" client widget · opens an inline modal with the create form.
// The form is a thin wrapper around the createBill server action; full edit
// happens on /chairops/bills/[id].

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { createBill, checkAnomaly } from "../actions";
import { baht } from "@/lib/chairops/utils/format";

interface Branch {
  id: string;
  name: string;
}
interface Category {
  id: string;
  code: string;
  label: string;
}

interface Props {
  branches: Branch[];
  categories: Category[];
  presetBranchId?: string | null;
  presetMonth?: string | null;
}

export function NewBillButton({
  branches,
  categories,
  presetBranchId,
  presetMonth,
}: Props) {
  // Auto-open when the page got ?branch=&month= from a cell click — init state
  // directly from props (no effect · React purity rule).
  const [open, setOpen] = useState(
    Boolean(presetBranchId && presetMonth),
  );
  const [error, setError] = useState<string | null>(null);
  const [anomaly, setAnomaly] = useState<{
    prev: number | null;
    deltaPct: number | null;
    isAnomalous: boolean;
    prevPeriodIso: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const defaultMonth =
    presetMonth ??
    (() => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      return `${yyyy}-${mm}`;
    })();
  const defaultDue = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const onAmountBlur = () => {
    const form = formRef.current;
    if (!form) return;
    const branchId = (form.elements.namedItem("branchId") as HTMLSelectElement)
      ?.value;
    const categoryId = (
      form.elements.namedItem("categoryId") as HTMLSelectElement
    )?.value;
    const billPeriod = (
      form.elements.namedItem("billPeriod") as HTMLInputElement
    )?.value;
    const amountStr = (form.elements.namedItem("amount") as HTMLInputElement)
      ?.value;
    const amount = Number(amountStr);
    if (!branchId || !categoryId || !billPeriod || !amount) {
      setAnomaly(null);
      return;
    }
    startTransition(async () => {
      const result = await checkAnomaly({
        branchId,
        categoryId,
        billPeriod,
        amount,
      });
      if (result.ok) setAnomaly(result.data ?? null);
    });
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createBill(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
      if (result.data?.id) router.push(`/chairops/bills/${result.data.id}`);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        บันทึกบิลใหม่
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-bill-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <h2
                id="new-bill-title"
                className="text-sm font-semibold text-zinc-900"
              >
                บันทึกบิลใหม่
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
                aria-label="ปิด"
              >
                <X className="size-4" />
              </button>
            </header>
            <form
              ref={formRef}
              onSubmit={onSubmit}
              className="space-y-3 px-4 py-4"
            >
              <Field label="สาขา">
                <select
                  name="branchId"
                  defaultValue={presetBranchId ?? ""}
                  required
                  onChange={onAmountBlur}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                >
                  <option value="" disabled>
                    เลือกสาขา…
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="เดือนบิล">
                <input
                  type="month"
                  name="billPeriod"
                  defaultValue={defaultMonth}
                  required
                  onBlur={onAmountBlur}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </Field>

              <Field label="หมวดบิล">
                <select
                  name="categoryId"
                  required
                  onChange={onAmountBlur}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>
                    เลือกหมวด…
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="ยอดบิล (บาท)">
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0"
                  required
                  onBlur={onAmountBlur}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums"
                  placeholder="0.00"
                />
              </Field>

              {anomaly?.isAnomalous && anomaly.prev != null && anomaly.deltaPct != null ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠️ เดือนก่อน {baht(anomaly.prev)} · เดือนนี้แตกต่าง{" "}
                  <span className="font-semibold">
                    {anomaly.deltaPct > 0 ? "+" : ""}
                    {(anomaly.deltaPct * 100).toFixed(0)}%
                  </span>{" "}
                  · เช็คอีกครั้ง?
                </p>
              ) : null}

              <Field label="กำหนดชำระ">
                <input
                  type="date"
                  name="dueDate"
                  defaultValue={defaultDue}
                  required
                  className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </Field>

              <Field label="หมายเหตุ (เลือกใส่)">
                <input
                  type="text"
                  name="notes"
                  maxLength={200}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                  placeholder="เช่น เลขที่บิล / ผู้ออกใบ"
                />
              </Field>

              {error ? (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              ) : null}

              <footer className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isPending ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-700">
        {label}
      </span>
      {children}
    </label>
  );
}
