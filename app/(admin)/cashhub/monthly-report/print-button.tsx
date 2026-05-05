"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-9 px-4 rounded-xl bg-[var(--color-brand-600)] text-white text-sm font-bold inline-flex items-center gap-1.5 shadow-blue"
    >
      <Printer className="size-4" />
      Print / PDF
    </button>
  );
}
