import { cn } from "@/lib/utils/cn";
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
        "rounded-2xl border-2 border-zinc-200 bg-white shadow-soft transition-colors",
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
        "flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100",
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
        "px-5 py-3 border-t border-zinc-100 flex items-center justify-end gap-2 bg-zinc-50/40",
        className,
      )}
      {...props}
    />
  );
}
