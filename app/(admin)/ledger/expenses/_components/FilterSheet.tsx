"use client";

// FilterSheet — the "ตัวกรอง" control for the รายจ่าย list.
// Redesign 2026-06-07 (CEO "filter รก"): ONE single "ตัวกรอง (n)" button on EVERY
// breakpoint that opens a popover (desktop: centered card · mobile: bottom-sheet)
// holding ALL the secondary filters — แหล่งที่มา / การส่ง TRCloud / สถานะใบกำกับ /
// หมวด / สถานะเอกสาร. The PRIMARY status switch (รอยืนยัน/ยืนยันแล้ว/ส่งแล้ว) is a
// prominent segmented strip rendered by the parent (ExpenseList) — NOT here. This
// stops the desktop header from stacking 5 chip-groups.
// It owns NO URL state: the parent passes the active values + the shared
// `onSet(key, value)` (the existing setParam URL pattern) + `onClear`.
import { useState, useEffect, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";
import type { ExpenseTab } from "../page";

// แหล่งที่มาของใบ (?tab=) — ย้ายจากแถบแท็บด้านบนเข้ามาในตัวกรอง (declutter).
const SOURCE_TABS: Array<{ value: ExpenseTab; label: string }> = [
  { value: "all", label: "ทุกแหล่ง" },
  { value: "line", label: "สแกนจาก LINE" },
  { value: "email", label: "อีเมล" },
  { value: "web", label: "เพิ่มเอง" },
  { value: "mine", label: "ส่วนตัว" },
];

// สถานะเอกสารเพิ่มเติม (ล็อก/ยกเลิก) — ของหลัก (ร่าง/ยืนยัน/ส่งแล้ว) อยู่บนแถบ primary แล้ว.
const STATUS_TABS: Array<{ value: LedgerStatusValue | ""; label: string }> = [
  { value: "", label: "ทุกสถานะ" },
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

// เรียงลำดับ (?sort=) — "" = default "อัจฉริยะ" (งานค้างลอยบนสุด · ของพึ่งอัพโผล่).
const SORT_TABS: Array<{
  value: "" | "date-desc" | "date-asc" | "amount-desc" | "amount-asc" | "created-desc";
  label: string;
}> = [
  { value: "", label: "อัจฉริยะ · งานค้างก่อน" },
  { value: "created-desc", label: "ล่าสุดที่บันทึก" },
  { value: "date-desc", label: "ใหม่→เก่า (วันเอกสาร)" },
  { value: "date-asc", label: "เก่า→ใหม่ (วันเอกสาร)" },
  { value: "amount-desc", label: "ยอดมาก→น้อย" },
  { value: "amount-asc", label: "ยอดน้อย→มาก" },
];

export interface FilterSheetProps {
  status?: LedgerStatusValue;
  tr?: "sent" | "unsent";
  cc?: "green" | "yellow" | "red";
  categoryId?: string;
  categories: Array<{ id: string; name: string; color: string | null; sort: number }>;
  /** โครงการที่กรองอยู่ (?project=) — optional job-costing tag. */
  projectId?: string;
  /** ตัวเลือกโครงการ active — ไม่ส่ง/ว่าง = ซ่อนแถวกรองโครงการ. */
  projects?: Array<{ value: string; label: string }>;
  /** แหล่งที่มา (?tab=) — moved into the popover (was a top tab strip). */
  tab?: ExpenseTab;
  /** เรียงลำดับ (?sort=) — moved into the popover (LeanUX · was a top select).
   *  undefined = default "อัจฉริยะ" (งานค้างลอยบนสุด). */
  sort?: "date-desc" | "date-asc" | "amount-desc" | "amount-asc" | "created-desc";
  /** Shared URL setter from the parent (setParam) — key/value, '' clears. */
  onSet: (key: string, value: string) => void;
  /** Clears status+tr+cc+category+tab in ONE router push (sequential onSet calls
   *  would each re-push from the same baseParams snapshot — only the last wins). */
  onClear: () => void;
  /** Shortcut actions (ไม่มีใบเสร็จ · สลิปรอจับคู่) shown at the top of the sheet —
   *  moved off the cramped page header (CEO 2026-06-06 "ยุบเข้าตัวกรอง"). */
  extraActions?: ReactNode;
  /** LeanUX (CEO 2026-06-08): บริษัท/สาขา picker — folded into the sheet on mobile
   *  (the header hides it on mobile). Rendered sm:hidden at the very top. */
  scopePicker?: ReactNode;
}

/** How many filters are non-default (drives the "ตัวกรอง (n)" badge). Status is the
 *  primary strip's job, so it's NOT counted here — only the secondary filters are. */
function activeCount(p: FilterSheetProps): number {
  let n = 0;
  if (p.tab && p.tab !== "all") n += 1;
  if (p.tr) n += 1;
  if (p.cc) n += 1;
  if (p.categoryId) n += 1;
  if (p.projectId) n += 1;
  if (p.status === "locked" || p.status === "void") n += 1;
  return n;
}

const chipBase =
  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)]";

/** One filter row as a WAI-ARIA tablist. */
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

/** The actual controls inside the popover/sheet. */
function FilterControls({ status, tr, cc, categoryId, categories, projectId, projects, tab, sort, onSet }: FilterSheetProps) {
  return (
    <>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">เรียงลำดับ</p>
        <ChipTablist
          label="เรียงลำดับ"
          tabs={SORT_TABS}
          active={sort ?? ""}
          paramKey="sort"
          activeClass="bg-[var(--color-brand-600)] text-white"
          onSet={onSet}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">แหล่งที่มา</p>
        <ChipTablist
          label="กรองตามแหล่งที่มา"
          tabs={SOURCE_TABS.map((t) => ({ value: t.value === "all" ? "" : t.value, label: t.label }))}
          active={!tab || tab === "all" ? "" : tab}
          paramKey="tab"
          activeClass="bg-[var(--color-brand-600)] text-white"
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
        <p className="text-[11px] font-semibold text-zinc-500">สถานะเอกสาร</p>
        <ChipTablist
          label="กรองตามสถานะเอกสาร"
          tabs={STATUS_TABS}
          active={status ?? ""}
          paramKey="status"
          activeClass="bg-[var(--color-brand-600)] text-white"
          onSet={onSet}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-zinc-500">หมวดหมู่</p>
        <select
          aria-label="กรองตามหมวด"
          value={categoryId ?? ""}
          onChange={(e) => onSet("category", e.target.value)}
          className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        >
          <option value="">ทุกหมวด</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {/* โครงการ (F2) — โชว์เฉพาะตอนมีโครงการ active (progressive disclosure · ไม่โผล่ถ้าไม่มี). */}
      {projects && projects.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-zinc-500">โครงการ</p>
          <select
            aria-label="กรองตามโครงการ"
            value={projectId ?? ""}
            onChange={(e) => onSet("project", e.target.value)}
            className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            <option value="">ทุกโครงการ</option>
            {projects.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

export function FilterSheet(props: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const n = activeCount(props);

  // Close on Escape (a11y) for both desktop popover + mobile sheet.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* ONE trigger button on every breakpoint (declutter). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
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

      {/* Overlay panel — bottom-sheet on mobile, centered card on desktop. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="ตัวกรอง"
        >
          <button
            type="button"
            aria-label="ปิดตัวกรอง"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-2xl sm:border">
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
            {/* บริษัท/สาขา — mobile only (header shows it on desktop). LeanUX: scope
                lives in the filter, not as always-visible top rows. */}
            {props.scopePicker && (
              <div className="mb-3 space-y-1 border-b border-zinc-100 pb-3 sm:hidden">
                <p className="text-[11px] font-semibold text-zinc-500">บริษัท / สาขา</p>
                {props.scopePicker}
              </div>
            )}
            {props.extraActions && (
              <div className="mb-3 flex flex-wrap gap-2 border-b border-zinc-100 pb-3">
                {props.extraActions}
              </div>
            )}
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
