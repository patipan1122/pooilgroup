// Linear-style compact bordered status pill.
// Used in list rows + ticket/application detail headers where `<Badge>`
// (pastel rounded-full) doesn't read tight enough.
//
// Extracted from inline spans in `components/repair/admin-inbox.tsx` /
// `ticket-detail-panel.tsx` (Polish Team รอบ 45 Agent C insight).
//
// `<Badge>` is still preferred for prose / tags (filled pastel pills).
// `<StatusPill>` is for **status indicators** in dense UI.

import { cn } from "@/lib/fuelos/utils/cn";
import type { ReactNode } from "react";

type Tone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "violet"
  | "orange"
  | "amber";

const tones: Record<Tone, { bg: string; text: string; border: string; dot: string }> = {
  neutral: {
    bg: "bg-zinc-100",
    text: "text-zinc-700",
    border: "border-zinc-300",
    dot: "bg-zinc-500",
  },
  brand: {
    bg: "bg-[var(--color-brand-50)]",
    text: "text-[var(--color-brand-700)]",
    border: "border-[var(--color-brand-200)]",
    dot: "bg-[var(--color-brand-500)]",
  },
  success: {
    bg: "bg-[var(--color-leaf-50)]",
    text: "text-[var(--color-leaf-700)]",
    border: "border-[var(--color-leaf-200)]",
    dot: "bg-[var(--color-leaf-500)]",
  },
  warning: {
    bg: "bg-[var(--color-warning)]/10",
    text: "text-[var(--color-warning)]",
    border: "border-[var(--color-warning)]/30",
    dot: "bg-[var(--color-warning)]",
  },
  danger: {
    bg: "bg-[var(--color-danger)]/10",
    text: "text-[var(--color-danger)]",
    border: "border-[var(--color-danger)]/30",
    dot: "bg-[var(--color-danger)]",
  },
  info: {
    bg: "bg-[var(--color-info)]/10",
    text: "text-[var(--color-info)]",
    border: "border-[var(--color-info)]/30",
    dot: "bg-[var(--color-info)]",
  },
  violet: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
    dot: "bg-violet-500",
  },
  orange: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    dot: "bg-orange-500",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
};

export interface StatusPillProps {
  tone?: Tone;
  /** Show a colored dot prefix (Linear-style) */
  dot?: boolean;
  /** Tighter size for compact list rows */
  size?: "xs" | "sm";
  className?: string;
  children: ReactNode;
}

export function StatusPill({
  tone = "neutral",
  dot = false,
  size = "sm",
  className,
  children,
}: StatusPillProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-bold",
        size === "xs" ? "h-5 px-1.5 text-xs" : "h-6 px-2 text-xs",
        t.bg,
        t.text,
        t.border,
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}
