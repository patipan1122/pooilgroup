"use client";

// Compact date picker for the LIFF report form (Anti-Stupidity Rule 2).
//
// CASHHUB §2 Rule 2: dropdown ของวันต้องแสดงเฉพาะวันที่ "ยังว่าง"
//   ✅ วันที่ยังไม่กรอกเลย — เลือกได้
//   ⏳ วันที่ submit แล้ว แต่ยัง pending → แสดง "popup ยืนยันแก้ไข" (ใน v1 = อ่านอย่างเดียว)
//   ❌ วันที่ approved → ซ่อน ไม่ให้เลือก ต้อง super_admin unlock เท่านั้น
//
// UI: pill button + dropdown of last 14 days. Today + open dates clickable.
// Approved dates greyed out + show "✅ ปิดแล้ว" badge so staff understand why.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Calendar, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DateStatus {
  date: string; // YYYY-MM-DD
  status: "open" | "submitted" | "approved";
}

interface Props {
  branchId: string;
  currentDate: string;
  available: DateStatus[]; // sorted newest → oldest
}

const STATUS_LABEL: Record<string, string> = {
  open: "ยังว่าง",
  submitted: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
};

const STATUS_TONE: Record<string, string> = {
  open: "text-zinc-700",
  submitted: "text-amber-700",
  approved: "text-zinc-400",
};

export function DatePickerPill({ branchId, currentDate, available }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function pick(d: DateStatus) {
    if (d.status === "approved") return; // locked
    setOpen(false);
    if (d.date === currentDate) return;
    router.push(`/liff/report/${branchId}?date=${d.date}`);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)] hover:border-[var(--color-brand-400)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Calendar className="size-3" />
        <span className="tabular-num">{currentDate}</span>
        <ChevronDown className="size-3 opacity-60" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-xl border-2 border-zinc-200 bg-white shadow-xl z-20"
        >
          <div className="px-3 py-2 border-b border-zinc-100 text-xs font-bold text-zinc-500">
            เลือกวันที่กรอก
          </div>
          <ul className="py-1">
            {available.map((d) => {
              const isCurrent = d.date === currentDate;
              const isLocked = d.status === "approved";
              return (
                <li key={d.date}>
                  <button
                    type="button"
                    onClick={() => pick(d)}
                    disabled={isLocked}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2",
                      isLocked
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-zinc-50",
                      isCurrent && "bg-[var(--color-brand-50)]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {isCurrent && (
                        <Check className="size-3 text-[var(--color-brand-700)]" />
                      )}
                      <span className="font-mono tabular-num text-zinc-900 font-bold">
                        {d.date}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded",
                        STATUS_TONE[d.status],
                        d.status === "approved" && "bg-zinc-100",
                        d.status === "submitted" && "bg-amber-50",
                      )}
                    >
                      {STATUS_LABEL[d.status]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-3 py-2 border-t border-zinc-100 text-[10px] text-zinc-500 leading-relaxed">
            วันที่ <b>อนุมัติแล้ว</b> ถูกล็อก — ขอ super admin ปลดล็อกถ้าต้องแก้
          </div>
        </div>
      )}
    </div>
  );
}
