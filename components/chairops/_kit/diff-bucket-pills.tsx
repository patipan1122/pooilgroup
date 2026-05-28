"use client";

// DiffBucketPills · 4-bucket CSV diff filter chips (POS-ingest preview).
// Spec: AUDIT_chairops_2026-05-25 §6.diff tokens.
//
// Click each pill to filter the preview table. Active pill is solid-ring.
// Counts use Thai number formatting; emojis are decorative (Lucide preferred
// elsewhere but per spec these 4 emojis are the brand mnemonic).

import { cn } from "@/lib/utils/cn";

export type DiffBucket = "new" | "same" | "changed" | "bad";

export interface DiffBucketCounts {
  new: number;
  same: number;
  changed: number;
  bad: number;
}

export interface DiffBucketPillsProps {
  counts: DiffBucketCounts;
  /** Active bucket filter (or null = show all). */
  active?: DiffBucket | null;
  /** Click handler. Pass the bucket clicked, or `null` to clear filter. */
  onSelect?: (bucket: DiffBucket | null) => void;
  /** Render as non-interactive chips (no hover/active affordance). Use when
   * a parent wants a summary display without filter wiring. */
  readOnly?: boolean;
  className?: string;
}

const BUCKET_META: Record<
  DiffBucket,
  { emoji: string; label: string; bg: string; text: string; ring: string }
> = {
  new: {
    emoji: "🆕",
    label: "ใหม่",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
  },
  same: {
    emoji: "⚪",
    label: "เหมือนเดิม",
    bg: "bg-zinc-50",
    text: "text-zinc-600",
    ring: "ring-zinc-200",
  },
  changed: {
    emoji: "🟡",
    label: "เปลี่ยน",
    bg: "bg-amber-50",
    text: "text-amber-800",
    ring: "ring-amber-200",
  },
  bad: {
    emoji: "🔴",
    label: "ผิด",
    bg: "bg-rose-50",
    text: "text-rose-700",
    ring: "ring-rose-200",
  },
};

const ORDER: DiffBucket[] = ["new", "same", "changed", "bad"];

export function DiffBucketPills({
  counts,
  active = null,
  onSelect,
  readOnly = false,
  className,
}: DiffBucketPillsProps) {
  // If no onSelect handler AND not explicitly interactive, render as
  // non-interactive chips to avoid dead-button affordance (B5).
  const interactive = !readOnly && typeof onSelect === "function";

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      role="group"
      aria-label={interactive ? "ตัวกรองผลเปรียบเทียบไฟล์" : "สรุปผลเปรียบเทียบไฟล์"}
    >
      {ORDER.map((bucket) => {
        const meta = BUCKET_META[bucket];
        const count = counts[bucket];
        const isActive = active === bucket;
        const isInactive = active !== null && active !== bucket;
        const chipClass = cn(
          "inline-flex h-9 min-w-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1",
          meta.bg,
          meta.text,
          meta.ring,
          isActive && "ring-2 ring-offset-1 ring-offset-background",
          interactive && "h-11 transition-all hover:scale-[1.02] active:scale-100",
          interactive && isInactive && "opacity-50 hover:opacity-100",
        );
        const inner = (
          <>
            <span aria-hidden="true">{meta.emoji}</span>
            <span>{meta.label}</span>
            <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-xs font-bold tabular-nums">
              {count.toLocaleString("th-TH")}
            </span>
          </>
        );
        if (!interactive) {
          return (
            <span key={bucket} className={chipClass}>
              {inner}
            </span>
          );
        }
        return (
          <button
            key={bucket}
            type="button"
            onClick={() => onSelect?.(isActive ? null : bucket)}
            aria-pressed={isActive}
            className={chipClass}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
