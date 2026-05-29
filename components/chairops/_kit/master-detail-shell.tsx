// MasterDetailShell · 3-pane workspace layout for (office) routes.
// Spec: AUDIT_chairops_2026-05-25 §6.layout tokens.
//
// Pattern: 260px sidebar (list) · flex main (detail) · 360px right rail (meta).
// Below md, collapses to single column (sidebar hidden / right pane stacks).
// SERVER-FRIENDLY · pure layout primitive · no client state.
//
// Slots:
//   - sidebar  → list nav / branch list
//   - children → main content (detail pane)
//   - meta     → right rail (photo proof / audit / actions)
//
// Use inside `.chairops-scope` wrapper that the (office)/layout.tsx provides.

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

export interface MasterDetailShellProps {
  sidebar?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Hide sidebar on md+ (single-pane mode, e.g. exec home). */
  noSidebar?: boolean;
  /** Hide meta pane on lg+ (when no right rail is needed). */
  noMeta?: boolean;
}

export function MasterDetailShell({
  sidebar,
  meta,
  children,
  className,
  noSidebar = false,
  noMeta = false,
}: MasterDetailShellProps) {
  // grid-cols: mobile = 1 · md = 220 + flex · lg = 260 + flex + 360
  const gridCols = (() => {
    if (noSidebar && noMeta) return "lg:grid-cols-1";
    if (noSidebar)
      return "md:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]";
    if (noMeta)
      return "md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]";
    return "md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)_360px]";
  })();

  return (
    <div
      className={cn(
        "grid min-h-[calc(100dvh-3.5rem)] grid-cols-1",
        gridCols,
        className,
      )}
    >
      {sidebar && !noSidebar && (
        <aside
          className={cn(
            "hidden border-r border-border bg-zinc-50 md:block",
            "overflow-y-auto",
          )}
          aria-label="แถบรายการ"
        >
          {sidebar}
        </aside>
      )}

      <main className="min-w-0 bg-background">
        <div className="p-4 sm:p-6">{children}</div>
      </main>

      {meta && !noMeta && (
        <aside
          className={cn(
            "hidden border-t border-border bg-zinc-50/60 lg:block lg:border-l lg:border-t-0",
            "overflow-y-auto",
          )}
          aria-label="แถบข้อมูลประกอบ"
        >
          <div className="p-4">{meta}</div>
        </aside>
      )}
    </div>
  );
}

/**
 * Helper for sticky table headers inside the main pane.
 * Use as: <thead className={stickyTheadClass()}>
 * Solid bg per [[sticky-bg-inherit-anti-pattern]] · NEVER /20 /30 /40 translucent.
 * IMPORTANT: also put the bg on the header <tr> CELLS, e.g.
 *   <tr className="bg-zinc-50 [&>th]:bg-zinc-50">
 * Chrome drops <thead>/<tr> bg during position:sticky, so the <th> must paint
 * itself or rows bleed through (the "ตัวหนังสือบังกัน" overlap bug, 2026-05-29).
 */
export function stickyTheadClass(extra?: string): string {
  return cn(
    "sticky top-0 z-20 bg-background",
    "border-b border-border",
    extra,
  );
}
