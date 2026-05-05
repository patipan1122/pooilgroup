import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Friendly empty state — never just "no data".
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="size-14 mx-auto mb-3 rounded-2xl bg-white border-2 border-zinc-200 flex items-center justify-center text-[var(--color-brand-600)]">
          {icon}
        </div>
      )}
      <h3 className="font-semibold text-zinc-900 font-display">{title}</h3>
      {description && (
        <p className="text-sm text-zinc-500 mt-1.5 max-w-sm mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
