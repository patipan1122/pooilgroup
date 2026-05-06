"use client";

import { cn } from "@/lib/utils/cn";
import { useState, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { Dialog } from "./dialog";

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  /**
   * Optional URL to an example image (admin-set).
   * When provided, a small camera icon is rendered beside the label.
   * Click → popup with image (in-page modal, never opens new tab/link).
   * feedback_form_image_hint.md
   */
  hintImageUrl?: string;
  hintImageCaption?: string;
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
  hintImageUrl,
  hintImageCaption,
}: FieldProps) {
  const [imageOpen, setImageOpen] = useState(false);
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
          {hintImageUrl && (
            <button
              type="button"
              onClick={() => setImageOpen(true)}
              aria-label="ดูรูปตัวอย่าง"
              className="ml-1 inline-flex items-center justify-center size-5 rounded-md text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] hover:text-[var(--color-brand-800)] transition-colors"
            >
              <ImageIcon className="size-3.5" />
            </button>
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
      {hintImageUrl && (
        <Dialog
          open={imageOpen}
          onClose={() => setImageOpen(false)}
          title={label ? `ตัวอย่าง · ${label}` : "ตัวอย่าง"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hintImageUrl}
            alt={label ? `ตัวอย่าง ${label}` : "ตัวอย่าง"}
            className="w-full rounded-xl border border-zinc-200"
          />
          {hintImageCaption && (
            <p className="mt-3 text-sm text-zinc-600">{hintImageCaption}</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
