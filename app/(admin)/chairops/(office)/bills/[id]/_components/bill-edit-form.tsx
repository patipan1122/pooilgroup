"use client";

// Full bill edit form · runs updateBill + checkAnomaly server actions.
// Anomaly warning is inline + non-blocking per CEO decision (F2 ±20% rule).

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateBill, checkAnomaly } from "../../actions";
import { SlipUploader } from "./slip-uploader";
import { baht } from "@/lib/chairops/utils/format";

interface Defaults {
  branchId: string;
  billPeriod: string; // "YYYY-MM"
  categoryId: string;
  amount: number;
  dueDate: string; // "YYYY-MM-DD"
  paidAt: string; // "YYYY-MM-DD" or ""
  paidAmount: number | null;
  slipPhotoUrl: string | null;
  bankAccountTo: string | null;
  paymentTerms: string | null;
  notes: string | null;
}

interface Props {
  billId: string;
  defaults: Defaults;
  branches: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; label: string }>;
  branchSlug: string;
  initialAnomaly: {
    prev: number | null;
    deltaPct: number | null;
    isAnomalous: boolean;
  };
}

export function BillEditForm({
  billId,
  defaults,
  branches,
  categories,
  branchSlug,
  initialAnomaly,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [anomaly, setAnomaly] = useState(initialAnomaly);
  const [slipUrl, setSlipUrl] = useState<string | null>(
    defaults.slipPhotoUrl,
  );
  // BA-03 (2026-06-03) · live amount-vs-paid tracker so the CEO sees the
  // shortfall/overpay BEFORE submitting (the server-side guard rejects > 5%
  // overpay, but the UI surfaces partial-pay + small variances inline so the
  // operator can fix typos without a round-trip).
  const [amountInput, setAmountInput] = useState<number>(defaults.amount);
  const [paidAmountInput, setPaidAmountInput] = useState<number | null>(
    defaults.paidAmount,
  );
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const recheckAnomaly = () => {
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
    const amount = Number(
      (form.elements.namedItem("amount") as HTMLInputElement)?.value,
    );
    if (!branchId || !categoryId || !billPeriod || !amount) return;
    startTransition(async () => {
      const result = await checkAnomaly({
        branchId,
        categoryId,
        billPeriod,
        amount,
      });
      if (result.ok && result.data) {
        setAnomaly({
          prev: result.data.prev,
          deltaPct: result.data.deltaPct,
          isAnomalous: result.data.isAnomalous,
        });
      }
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    const fd = new FormData(e.currentTarget);
    fd.set("id", billId);
    if (slipUrl) fd.set("slipPhotoUrl", slipUrl);
    startTransition(async () => {
      const result = await updateBill(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="สาขา">
          <select
            name="branchId"
            defaultValue={defaults.branchId}
            required
            onChange={recheckAnomaly}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          >
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
            defaultValue={defaults.billPeriod}
            required
            onBlur={recheckAnomaly}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          />
        </Field>
        <Field label="หมวดบิล">
          <select
            name="categoryId"
            defaultValue={defaults.categoryId}
            required
            onChange={recheckAnomaly}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          >
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
            defaultValue={defaults.amount}
            onBlur={recheckAnomaly}
            onChange={(e) =>
              setAmountInput(Number(e.currentTarget.value) || 0)
            }
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums"
          />
        </Field>
      </div>

      {anomaly.isAnomalous &&
      anomaly.prev != null &&
      anomaly.deltaPct != null ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ เดือนก่อน {baht(anomaly.prev)} · เดือนนี้แตกต่าง{" "}
          <span className="font-semibold">
            {anomaly.deltaPct > 0 ? "+" : ""}
            {(anomaly.deltaPct * 100).toFixed(0)}%
          </span>{" "}
          · เช็คอีกครั้ง?
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="กำหนดชำระ">
          <input
            type="date"
            name="dueDate"
            defaultValue={defaults.dueDate}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          />
        </Field>
        <Field label="วันที่จ่าย (เลือกใส่)">
          <input
            type="date"
            name="paidAt"
            defaultValue={defaults.paidAt}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          />
        </Field>
        <Field label="ยอดที่จ่าย (เลือกใส่)">
          <input
            type="number"
            name="paidAmount"
            step="0.01"
            min="0"
            defaultValue={defaults.paidAmount ?? ""}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              setPaidAmountInput(raw === "" ? null : Number(raw) || 0);
            }}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums"
          />
        </Field>
        <Field label="ธนาคารผู้รับ">
          <input
            type="text"
            name="bankAccountTo"
            maxLength={200}
            defaultValue={defaults.bankAccountTo ?? ""}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
            placeholder="เช่น KBANK 123-4-56789-0"
          />
        </Field>
      </div>

      {/* BA-03 (2026-06-03) · live diff tracker · partial pay warning */}
      {paidAmountInput != null && paidAmountInput > 0 ? (
        (() => {
          const diff = amountInput - paidAmountInput;
          const overpay = paidAmountInput > amountInput * 1.05;
          const partial =
            paidAmountInput > 0 && paidAmountInput < amountInput * 0.98;
          if (overpay) {
            return (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                ⚠️ ยอดที่จ่าย {baht(paidAmountInput)} เกินยอดบิล{" "}
                {baht(amountInput)} · ตรวจตัวเลขอีกครั้ง
              </p>
            );
          }
          if (partial) {
            return (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                💡 จ่ายบางส่วน · ยอดบิล {baht(amountInput)} · จ่าย{" "}
                {baht(paidAmountInput)} · ส่วนต่าง{" "}
                <span className="font-semibold">{baht(diff)}</span>
              </p>
            );
          }
          return (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              ✓ ยอดที่จ่ายตรง · ส่วนต่าง {baht(Math.abs(diff))}
            </p>
          );
        })()
      ) : null}

      <Field label="เงื่อนไขการชำระ">
        <input
          type="text"
          name="paymentTerms"
          maxLength={200}
          defaultValue={defaults.paymentTerms ?? ""}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          placeholder="เช่น Net 30 / ก่อนสิ้นเดือน"
        />
      </Field>

      <Field label="หมายเหตุ">
        <textarea
          name="notes"
          maxLength={2000}
          rows={2}
          defaultValue={defaults.notes ?? ""}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
        />
      </Field>

      <Field label="สลิปการจ่าย (เลือกใส่)">
        <SlipUploader
          branchSlug={branchSlug}
          billId={billId}
          value={slipUrl}
          onChange={setSlipUrl}
        />
      </Field>

      {error ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          บันทึกแล้ว
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
        </button>
      </div>
    </form>
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
