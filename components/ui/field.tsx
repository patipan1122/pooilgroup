"use client";

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
  className,
  htmlFor,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1 text-sm font-medium text-zinc-800"
        >
          {label}
          {required && <span className="text-[var(--color-danger)]">*</span>}
          {optional && (
            <span className="text-zinc-400 font-normal">(ไม่บังคับ)</span>
          )}
        </label>
      )}
      {children}
      {hint && !error && (
        <p className="text-xs text-zinc-500">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}
