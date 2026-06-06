"use client";

// FilterSheet — the status / TRCloud-send / VAT-colour / category filter controls
// for the รายจ่าย list, rendered in TWO layouts that share ONE source of truth:
//   • desktop (lg+): an inline single row of chip-groups + the category select.
//   • mobile (<lg):  a single "ตัวกรอง (n)" trigger that opens a bottom-sheet
//     holding the exact same controls — so a phone never stacks 4 dropdowns.
// It owns NO URL state: the parent (ExpenseList) passes the active values plus the
// shared `onSet(key, value)` (the existing setParam URL pattern), so every change
// still routes through the one server-driven GET round-trip.
import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";

const STATUS_TABS: Array<{ value: LedgerStatusValue | ""; label: string }> = [
  { value: "", label: "ทั้งหมด" },
  { value: "draft", label: "รอยืนยัน" },
  { value: "confirmed", label: "ยืนยันแล้ว" },
  { value: "locked", label: "ล็อก" },
  { value: "void", label: "ยกเลิก" },
];

const TR_TABS: Array<{ value: "" | "unsent" | "sent"; label: string }> = [
  { value: "", label: "ทุกการส่ง" },
  { value: "unsent", label: "ยังไม่ส่ง TRCloud" },
  { value: "sent", label: "ส่งแล้ว" },
];

// ภาษีซื้อ (input-VAT) colour filter — driven by ?cc=. Each tab carries a swatch so
// the meaning reads without a legend; the swatch ALSO has a text label (a11y).
const CC_TABS: Array<{ value: "" | "green" | "yellow" | "red"; label: string; dot: string }> = [
  { value: "", label: "ทุกสถานะใบ", dot: "" },
  { value: "green", label: "ขอคืนได้", dot: "bg-emerald-500" },
  { value: "yellow", label: "ขอใบใหม่", dot: "bg-amber-500" },
  { value: "red", label: "ขอคืนไม่ได้", dot: "bg-rose-500" },
];

export interface FilterSheetProps {
  status?: LedgerStatusValue;
  tr?: "sent" | "unsent";
  cc?: "green" | "yellow" | "red";
  categoryId?: string;
  categories: Array<{ id: string; name: string; color: string | null; sort: number }>;
  /** Shared URL setter from the parent (setParam) — key/value, '' clears. */
  onSet: (key: string, value: string) => void;
  /** Clears status+tr+cc+category in ONE router push (sequential onSet calls
   *  would each re-push from the same baseParams snapshot — only the last wins). */
  onClear: () => void;
}

/** How many filters are non-default (drives the "ตัวกรอง (n)" badge). cc lives in the
 *  SummaryStrip above too, but it's part of the same filter set so we count it here. */
function activeCount(p: FilterSheetProps): number {
  let n = 0;
  if (p.status) n += 1;
  if (p.tr) n += 1;
  if (p.cc) n += 1;
  if (p.categoryId) n += 1;
  return n;
}

const chipBase =
  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)]";

/** One filter row as a WAI-ARIA tablist (shared by inline + sheet layouts). */
function ChipTablist<T extends string>({
  label,
  tabs,
  active,
  paramKey,
  activeClass,
  onSet,
}: {
  label: string;
  tabs: Array<{ value: T | ""; label: string; dot?: string }>;
  active: T | "";
  paramKey: string;
  activeClass: string;
  onSet: (key: string, value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const isOn = active === t.value;
        return (
          <button
            key={t.value || `all-${paramKey}`}
            type="button"
            role="tab"
            aria-selected={isOn}
            onClick={() => onSet(paramKey, t.value)}
            className={
              (t.dot !== undefined ? "inline-flex items-center gap-1.5 " : "") +
              chipBase +
              " " +
              (isOn ? activeClass : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
            }
          >
            {t.dot ? <span className={"size-2 rounded-full " + t.dot} aria-hidden /> : null}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The actual controls — reused verbatim inline (desktop) and inside the sheet (mobile). */
function FilterControls({ status, tr, cc, categoryId, categories, onSet }: FilterSheetProps) {
  return (
    <>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">สถานะ</p>
        <ChipTablist
          label="กรองตามสถานะ"
          tabs={STATUS_TABS}
          active={status ?? ""}
          paramKey="status"
          activeClass="bg-[var(--color-brand-600)] text-white"
          onSet={onSet}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">การส่ง TRCloud</p>
        <ChipTablist
          label="กรองตามการส่ง TRCloud"
          tabs={TR_TABS}
          active={tr ?? ""}
          paramKey="tr"
          activeClass="bg-blue-600 text-white"
          onSet={onSet}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">สถานะใบกำกับ (ภาษีซื้อ)</p>
        <ChipTablist
          label="กรองตามสถานะใบกำกับ (ภาษีซื้อ)"
          tabs={CC_TABS}
          active={cc ?? ""}
          paramKey="cc"
          activeClass="bg-zinc-900 text-white"
          onSet={onSet}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">หมวดหมู่</p>
        <select
          aria-label="กรองตามหมวด"
          value={categoryId ?? ""}
          onChange={(e) => onSet("category", e.target.value)}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        >
          <option value="">ทุกหมวด</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function FilterSheet(props: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const n = activeCount(props);

  return (
    <>
      {/* DESKTOP (lg+): inline single row of chip-groups + category select. */}
      <div className="hidden flex-col gap-2 lg:flex">
        <FilterControls {...props} />
      </div>

      {/* MOBILE (<lg): one trigger button — opens the bottom-sheet below. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <SlidersHorizontal className="size-4" />
          ตัวกรอง
          {n > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-brand-600)] px-1.5 text-[11px] font-semibold text-white">
              {n}
            </span>
          )}
        </button>
      </div>

      {/* Bottom-sheet (mobile only) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="ตัวกรอง">
          <button
            type="button"
            aria-label="ปิดตัวกรอง"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-800">
                ตัวกรอง{n > 0 ? ` (${n})` : ""}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                aria-label="ปิด"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-3">
              <FilterControls {...props} />
            </div>
            <div className="mt-4 flex gap-2">
              {n > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    props.onClear();
                    setOpen(false);
                  }}
                  className="h-10 flex-1 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  ล้างตัวกรอง
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 flex-1 rounded-lg bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                ดูผลลัพธ์
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
