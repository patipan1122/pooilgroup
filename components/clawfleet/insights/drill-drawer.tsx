"use client";
// Insights · universal drill drawer (CLIENT shell only)
// Slides in from the right · 480px desktop · bottom sheet on mobile
// Closes on Esc · backdrop click · X · or "ปิด" footer button
//
// The body content is a pre-rendered server component (RSC) passed as `children`.
// See drill-bodies.tsx (server) for the per-view content renderers.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DrillDrawerProps {
  title: string;
  subtitle?: string;
  /** Pre-rendered server content */
  children: ReactNode;
  /** Optional footer actions (e.g. external link, status badge) */
  footer?: ReactNode;
}

export function DrillDrawer({
  title,
  subtitle,
  children,
  footer,
}: DrillDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  function close() {
    const next = new URLSearchParams(sp.toString());
    next.delete("drill");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Backdrop · z-40 per tokens */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer · z-50 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drill-drawer-title"
        tabIndex={-1}
        className={cn(
          "fixed z-50 flex flex-col bg-white shadow-2xl outline-none",
          // Mobile: bottom sheet (90vh)
          "bottom-0 left-0 right-0 max-h-[90vh] rounded-t-2xl",
          // Desktop: right rail (full height · 480px)
          "sm:top-0 sm:bottom-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[480px] sm:rounded-none sm:rounded-l-2xl lg:w-[560px]",
          pending && "opacity-90",
        )}
      >
        {/* Sticky header */}
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2
              id="drill-drawer-title"
              className="truncate text-base font-bold text-zinc-900"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="ปิด"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Sticky footer */}
        <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-zinc-200 bg-white px-5 py-3">
          <div className="flex flex-1 items-center gap-2">{footer}</div>
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:border-zinc-400"
          >
            ปิด
          </button>
        </footer>
      </div>
    </>
  );
}
