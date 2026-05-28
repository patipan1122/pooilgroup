// StatusDot (ChairOps kit) · 6px status circle for dense rows.
// Spec: MOCKUP_SPEC.md §C "StatusDot" + shell.jsx `<StatusDot />`.
//
// Mockup tones: ok (green) · warn (amber) · crit (red) · idle/neutral (gray).
// Pure server component.

import { cn } from "@/lib/utils/cn";

export type StatusDotTone = "ok" | "warn" | "critical" | "neutral";

const TONE_BG: Record<StatusDotTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-rose-500",
  neutral: "bg-zinc-400",
};

export interface StatusDotProps {
  tone?: StatusDotTone;
  className?: string;
}

export function StatusDot({ tone = "neutral", className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        TONE_BG[tone],
        className,
      )}
      aria-hidden="true"
    />
  );
}
