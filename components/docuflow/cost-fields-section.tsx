"use client";

/* ============================================================
   CostFieldsSection — ค่าใช้จ่าย/รายจ่ายของเอกสาร (CEO spec, locked —
   WORKSHOP_docuflow-org-structure-2026-10-10, Must #6).
   ------------------------------------------------------------
   Standalone metadata on the Document itself — explicitly NOT linked to
   Ledger/CashHub. Three fields: amount, a free-text label, and a
   frequency with exactly 3 options (รายเดือน/รายปี/จ่ายครั้งเดียว).

   Shared by:
     - upload-form.tsx (create path — collapsed section inside the
       upload wizard)
     - document-cost-editor.tsx (edit path — same section, mounted on
       the document detail page so the fields stay editable after
       upload too, since this repo doesn't otherwise have a document
       rename/edit view to piggyback on)

   Collapsed by default, never required — this is reference info only.
   The frequency control is a segmented/pill button row (not a native
   <select>), matching the toggle pattern already shipped in
   signature-placement-editor.tsx's TYPE_OPTIONS toolbar.
   ============================================================ */

import { useState } from "react";
import { ChevronDown, Wallet, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type CostFrequency = "monthly" | "yearly" | "one_time";

export const COST_FREQUENCY_OPTIONS: { value: CostFrequency; label: string }[] = [
  { value: "monthly", label: "รายเดือน" },
  { value: "yearly", label: "รายปี" },
  { value: "one_time", label: "จ่ายครั้งเดียว" },
];

/** Form-level shape — amount stays a string while being typed/edited so an
 * empty field and "0" are distinguishable, and so a half-typed decimal
 * ("12.") doesn't get coerced away mid-keystroke. Converted to a number
 * only at submit time. */
export interface CostFields {
  costAmount: string;
  costLabel: string;
  costFrequency: CostFrequency | "";
}

export const EMPTY_COST_FIELDS: CostFields = {
  costAmount: "",
  costLabel: "",
  costFrequency: "",
};

/** True if any field has a non-empty value — used by callers who want to
 * default the section open when a document already has cost info saved. */
export function hasCostFields(v: CostFields): boolean {
  return Boolean(v.costAmount.trim() || v.costLabel.trim() || v.costFrequency);
}

interface Props {
  values: CostFields;
  onChange: (next: CostFields) => void;
  disabled?: boolean;
  /** Default: false (collapsed) — this is optional reference info, never
   * shown expanded by default per the locked spec. */
  defaultOpen?: boolean;
}

export function CostFieldsSection({
  values,
  onChange,
  disabled,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  function patch(partial: Partial<CostFields>) {
    onChange({ ...values, ...partial });
  }

  return (
    <div className="border-2 border-zinc-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 transition-colors"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-700">
          <Wallet className="size-4 text-[var(--color-brand-600)]" />
          เพิ่มข้อมูลค่าใช้จ่าย (ถ้ามี)
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-zinc-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="p-4 space-y-4 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="costAmount"
                className="text-sm font-medium text-zinc-800"
              >
                จำนวนเงิน
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400 pointer-events-none">
                  ฿
                </span>
                <input
                  id="costAmount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={values.costAmount}
                  disabled={disabled}
                  onChange={(e) => patch({ costAmount: e.target.value })}
                  placeholder="0.00"
                  className="w-full h-10 pl-7 pr-3 text-sm rounded-lg border-2 border-zinc-200 bg-white focus:border-[var(--color-brand-500)] focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="costLabel"
                className="text-sm font-medium text-zinc-800"
              >
                ชื่อรายการ
              </label>
              <input
                id="costLabel"
                type="text"
                value={values.costLabel}
                disabled={disabled}
                onChange={(e) => patch({ costLabel: e.target.value })}
                placeholder="เช่น ค่าเช่าที่ดิน, ค่าเบี้ยประกัน"
                maxLength={255}
                className="w-full h-10 px-3 text-sm rounded-lg border-2 border-zinc-200 bg-white focus:border-[var(--color-brand-500)] focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-400"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-zinc-800">ความถี่</p>
            <div className="grid grid-cols-3 gap-1.5">
              {COST_FREQUENCY_OPTIONS.map((opt) => {
                const active = values.costFrequency === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      patch({
                        costFrequency: active ? "" : opt.value,
                      })
                    }
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm border transition-colors disabled:opacity-50",
                      active
                        ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                        : "border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700",
                    )}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-zinc-500 leading-relaxed">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            ข้อมูลอ้างอิงบนเอกสารนี้เท่านั้น ไม่ใช่ตัวเลขบัญชีจริง และไม่ได้ซิงค์
            กับ Ledger/CashHub
          </p>
        </div>
      )}
    </div>
  );
}
