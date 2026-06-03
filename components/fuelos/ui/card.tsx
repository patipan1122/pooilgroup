import { cn } from "@/lib/fuelos/utils/cn";
import type { HTMLAttributes } from "react";

/**
 * Card v2 — auditmekub-style framed card:
 * - border-2 (visible, not subtle)
 * - hover state with brand color
 * - Header has bottom divider (not just padding)
 */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-[var(--color-border)] bg-white shadow-soft transition-colors",
        "hover:border-zinc-300",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-base font-bold text-zinc-900 tracking-tight font-display",
        className,
      )}
      {...props}
    />
  );
}

export function CardSubtitle({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-zinc-500 mt-0.5", className)}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-surface-2)]",
        className,
      )}
      {...props}
    />
  );
}
