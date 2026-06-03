import { cn } from "@/lib/fuelos/utils/cn";
import type { HTMLAttributes } from "react";

type Tone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "orange"
  | "purple";

const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  success: "bg-[var(--color-leaf-50)] text-[var(--color-leaf-700)]",
  warning: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
  orange: "bg-orange-50 text-orange-700",
  purple: "bg-purple-50 text-purple-700",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
