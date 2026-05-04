"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-pop max-h-[90vh] flex flex-col safe-bottom",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
            <h2 className="text-lg font-semibold font-display">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 -m-1.5 rounded-lg hover:bg-zinc-100"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
      </div>
    </div>
  );
}
