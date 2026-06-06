"use client";

// AmountInput — ช่องกรอกจำนวนเงิน (บาท) สำหรับฟอร์มแก้ใบเสร็จ.
// - tabular-nums + จัดขวา (อ่านเลขเงินง่าย)
// - รับเฉพาะตัวเลข/จุดทศนิยม · แสดง "฿" prefix
// - controlled ผ่าน value/onValueChange (number) เพื่อให้ฟอร์มคำนวณ Recheck ได้
//
// IMPORTANT: holds the RAW typed string locally so the user can type "10." or
// "10.50" without the trailing dot / trailing zero being eaten by a round-trip
// through Number() (the classic controlled-number-input bug). We only re-sync
// the display from the prop when the prop's value differs from what we parsed.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

function normalizeMoney(input: string): string {
  const raw = input.replace(/[^\d.]/g, "");
  const parts = raw.split(".");
  return parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
}

function parseMoney(norm: string): number {
  if (norm === "" || norm === ".") return 0;
  const n = Number(norm);
  return Number.isNaN(n) ? 0 : n;
}

export function AmountInput({
  value,
  onValueChange,
  name,
  placeholder = "0.00",
  disabled,
  className,
  ariaLabel,
}: {
  value: number | null;
  onValueChange: (v: number) => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [raw, setRaw] = useState<string>(value == null ? "" : String(value));
  const lastEmitted = useRef<number>(value ?? 0);

  // Re-sync the display from the prop only on an EXTERNAL change (e.g. AI fills
  // the field, or "เติมยอดย่อยจากรายการ") — never when the prop change is just
  // the echo of what we just typed (that would eat the trailing dot/zeros).
  useEffect(() => {
    const v = value ?? 0;
    if (v !== lastEmitted.current) {
      setRaw(value == null ? "" : String(value));
      lastEmitted.current = v;
    }
  }, [value]);

  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-zinc-200 bg-white px-2 focus-within:ring-2 focus-within:ring-[var(--color-brand-200)]",
        disabled && "opacity-60",
        className,
      )}
    >
      <span className="select-none pr-1 text-sm text-zinc-400">฿</span>
      <input
        type="text"
        inputMode="decimal"
        name={name}
        aria-label={ariaLabel}
        disabled={disabled}
        value={raw}
        placeholder={placeholder}
        onChange={(e) => {
          const norm = normalizeMoney(e.target.value);
          setRaw(norm);
          const num = parseMoney(norm);
          lastEmitted.current = num;
          onValueChange(num);
        }}
        className="h-11 w-full bg-transparent text-right text-base tabular-nums outline-none sm:h-9 sm:text-sm"
      />
    </div>
  );
}
