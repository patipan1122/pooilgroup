import { cn } from "@/lib/utils/cn";
import type { HTMLAttributes, ReactNode } from "react";

interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  number?: string;
  label: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Numbered section with auditmekub-style label.
 * Usage:
 *   <Section number="01" label="OVERVIEW" title="..." description="...">
 *     {children}
 *   </Section>
 */
export function Section({
  number,
  label,
  title,
  description,
  action,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn("relative", className)} {...props}>
      {/* Section header */}
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
            {number && (
              <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[10px] tabular-num">
                {number}
              </span>
            )}
            {label}
          </p>
          {title && (
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display mt-1.5 text-zinc-900">
              {title}
            </h2>
          )}
          {description && (
            <p className="text-sm text-zinc-500 mt-1.5 max-w-2xl">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {/* Section content */}
      <div>{children}</div>
    </section>
  );
}

/**
 * Visual divider between sections — subtle horizontal rule + dot.
 */
export function SectionDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative my-8 flex items-center justify-center",
        className,
      )}
    >
      <div className="flex-1 h-px bg-zinc-200" />
      <span className="size-1.5 rounded-full bg-[var(--color-brand-400)] mx-3" />
      <div className="flex-1 h-px bg-zinc-200" />
    </div>
  );
}
