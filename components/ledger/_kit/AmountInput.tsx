"use client";

// AmountInput — ช่องกรอกจำนวนเงิน (บาท) สำหรับฟอร์มแก้ใบเสร็จ.
// - tabular-nums + จัดขวา (อ่านเลขเงินง่าย)
// - รับเฉพาะตัวเลข/จุดทศนิยม · แสดง "฿" prefix
// - controlled ผ่าน value/onValueChange (number) เพื่อให้ฟอร์มคำนวณ Recheck ได้
import { cn } from "@/lib/utils/cn";

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
        value={value == null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          // กันจุดทศนิยมซ้ำ
          const parts = raw.split(".");
          const norm =
            parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
          const num = norm === "" || norm === "." ? 0 : Number(norm);
          onValueChange(Number.isNaN(num) ? 0 : num);
        }}
        className="h-9 w-full bg-transparent text-right text-sm tabular-nums outline-none"
      />
    </div>
  );
}
