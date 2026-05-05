"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  prefixSlot?: React.ReactNode;
  suffixSlot?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, className, prefixSlot, suffixSlot, ...props }, ref) => {
    if (prefixSlot || suffixSlot) {
      return (
        <div
          className={cn(
            "relative flex h-12 items-center rounded-xl border bg-white",
            invalid
              ? "border-[var(--color-danger)] ring-1 ring-red-100"
              : "border-zinc-200 focus-within:border-[var(--color-brand-500)]",
            "transition-colors",
          )}
        >
          {prefixSlot && (
            <span className="pl-4 pr-2 text-zinc-500 select-none">
              {prefixSlot}
            </span>
          )}
          <input
            ref={ref}
            className={cn(
              "flex-1 h-full bg-transparent outline-none text-base text-zinc-900 placeholder:text-zinc-400 tabular-nums",
              prefixSlot ? "pl-0" : "pl-4",
              suffixSlot ? "pr-0" : "pr-4",
              className,
            )}
            {...props}
          />
          {suffixSlot && (
            <span className="px-4 text-zinc-500 select-none">{suffixSlot}</span>
          )}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-xl border bg-white px-4 text-base text-zinc-900",
          "placeholder:text-zinc-400 tabular-nums",
          "outline-none transition-colors",
          invalid
            ? "border-[var(--color-danger)] ring-1 ring-red-100"
            : "border-zinc-200 focus:border-[var(--color-brand-500)]",
          "disabled:bg-zinc-50 disabled:text-zinc-500",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
