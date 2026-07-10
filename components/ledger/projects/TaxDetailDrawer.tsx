"use client";

// รายละเอียดภาษี — แถวพับได้ (มือถือ = expandable row · เดสก์ท็อปก็พับได้เหมือนกัน).
// โชว์ VAT ซื้อ + หัก ณ ที่จ่าย ใต้พาดหัวต้นทุนสุทธิ. อ่านอย่างเดียว.
import { useState } from "react";
import { ChevronDown, Receipt } from "lucide-react";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function TaxDetailDrawer({
  vatTotal,
  whtTotal,
}: {
  vatTotal: number;
  whtTotal: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="press flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
          <Receipt className="size-4 text-zinc-400" aria-hidden />
          รายละเอียดภาษี
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 px-4 py-3">
          <div>
            <p className="text-xs text-zinc-500">VAT ซื้อ</p>
            <p className="text-lg font-semibold tabular-nums text-zinc-900">{baht(vatTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">หัก ณ ที่จ่าย</p>
            <p className="text-lg font-semibold tabular-nums text-zinc-900">{baht(whtTotal)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
