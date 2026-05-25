// ChairCodeChip · small pill for chair code identifier.
// Spec: AUDIT_chairops_2026-05-25 — chair codes like "G031-0421" used in
// damage tickets · parts requests · cleanliness reports.
//
// Shows: chair code (mono) · optional branch · optional status dot.
// SERVER-FRIENDLY · pure presentational.

import { cn } from "@/lib/utils/cn";

export type ChairStatus = "ok" | "warn" | "bad" | "offline" | "unknown";

const statusDot: Record<ChairStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  offline: "bg-zinc-400",
  unknown: "bg-zinc-300",
};

const statusLabel: Record<ChairStatus, string> = {
  ok: "ปกติ",
  warn: "เฝ้าระวัง",
  bad: "ขัดข้อง",
  offline: "ไม่ออนไลน์",
  unknown: "ไม่ทราบสถานะ",
};

export interface ChairCodeChipProps {
  /** Chair code e.g. "G031-0421". */
  code: string;
  /** Optional branch label e.g. "เมญ่า · ชั้น 4". */
  branch?: string;
  /** Optional chair status — shows colored dot prefix. */
  status?: ChairStatus;
  /** Optional href → makes the chip a link to the chair detail. */
  href?: string;
  size?: "sm" | "md";
  className?: string;
}

export function ChairCodeChip({
  code,
  branch,
  status,
  href,
  size = "sm",
  className,
}: ChairCodeChipProps) {
  const sizeClass =
    size === "sm" ? "h-6 px-2 text-xs" : "h-8 px-2.5 text-sm";

  const inner = (
    <>
      {status && (
        <span
          className={cn("size-2 rounded-full", statusDot[status])}
          aria-label={statusLabel[status]}
        />
      )}
      <span className="font-mono font-semibold text-zinc-900">{code}</span>
      {branch && (
        <>
          <span className="text-zinc-300" aria-hidden="true">
            ·
          </span>
          <span className="truncate text-zinc-600">{branch}</span>
        </>
      )}
    </>
  );

  const baseClass = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50",
    sizeClass,
    href && "transition-colors hover:border-zinc-300 hover:bg-white",
    className,
  );

  if (href) {
    return (
      <a href={href} className={baseClass}>
        {inner}
      </a>
    );
  }
  return <span className={baseClass}>{inner}</span>;
}
