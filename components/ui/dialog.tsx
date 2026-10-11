"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /**
   * ความเข้มของฉากหลัง:
   *  - "blur" (ค่าเริ่มต้น) = ดำ 40% + เบลอ (ของเดิม · ใช้กับโมดูลอื่น)
   *  - "soft" = ดำ 20% ไม่เบลอ → ยังเห็นข้อมูลข้างหลังราง ๆ (CEO #14: "อย่าเบลอจนมองอันอื่นไม่เห็น")
   *  - "none" = โปร่งใส
   */
  backdrop?: "blur" | "soft" | "none";
}

export function Dialog({ open, onClose, title, children, className, backdrop = "blur" }: DialogProps) {
  // Portal to document.body (bug found 2026-10-11 while verifying the
  // company-switcher confirm dialog on mobile): any ancestor with its own
  // stacking context — e.g. admin-shell's <header class="sticky z-40">,
  // which CompanySwitcher renders inside — traps a nested z-50 inside that
  // ancestor's z-40 context. It can never out-rank a *sibling* fixed element
  // like the bottom tab bar (also z-40, painted later in the DOM → wins the
  // tie), no matter what z-index this component declares internally.
  // elementFromPoint() confirmed real taps on the confirm button were
  // landing on the bottom nav instead. Portaling to <body> escapes every
  // ancestor's stacking context so z-50 is finally compared where it's
  // declared — fixes this for all ~22 call sites, not just the switcher.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className={cn(
          "absolute inset-0",
          backdrop === "blur" && "bg-zinc-950/40 backdrop-blur-sm",
          backdrop === "soft" && "bg-zinc-950/20",
          backdrop === "none" && "bg-transparent",
        )}
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

  // Before the client has mounted (first paint / hydration), document.body
  // isn't something we should portal into yet — render inline for that one
  // frame. Once mounted, always portal so stacking escapes every ancestor.
  if (!mounted) return dialog;
  return createPortal(dialog, document.body);
}
