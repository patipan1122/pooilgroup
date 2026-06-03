"use client";

// FloatingWindow — a NON-modal, draggable, portal-rendered window
// (CEO 2026-06-03). Unlike a <Dialog> it draws NO backdrop and does NOT block
// the page behind it, so the CEO can keep working / open several at once to
// compare bills side-by-side. Drag by the title bar; click anywhere to raise.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Module-level z allocator so the most-recently-touched window floats on top
// across every FloatingWindow instance.
let zCounter = 60;

export function FloatingWindow({
  title,
  subtitle,
  onClose,
  children,
  /** Cascade offset (px) so stacked windows don't perfectly overlap. */
  initialOffset = 0,
  width = 360,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  initialOffset?: number;
  width?: number;
}) {
  const [mounted, setMounted] = useState(false);
  // Initial position via a lazy initializer (NOT an effect) — runs once on the
  // first client render when window is available; falls back during SSR.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 24, y: 96 };
    const vw = window.innerWidth;
    const x = vw < 640 ? 12 : Math.max(16, vw - width - 32 - initialOffset);
    const y = (vw < 640 ? 72 : 100) + initialOffset;
    return { x, y };
  });
  const [z, setZ] = useState(() => ++zCounter);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // Portals need `document` (client only). The mount flag keeps the first
  // client render (null) identical to SSR (null) → no hydration mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const raise = () => setZ(++zCounter);

  const onPointerDown = (e: React.PointerEvent) => {
    raise();
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = e.clientX - drag.current.dx;
    const ny = e.clientY - drag.current.dy;
    // keep a grabbable strip on-screen so a window can't be lost off-edge
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 44;
    setPos({
      x: Math.min(Math.max(nx, -width + 120), maxX),
      y: Math.min(Math.max(ny, 0), maxY),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed flex max-h-[80vh] flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl"
      style={{ left: pos.x, top: pos.y, width, zIndex: z }}
      onMouseDown={raise}
      role="dialog"
      aria-label={typeof title === "string" ? title : "หน้าต่างลอย"}
    >
      <header
        className="flex cursor-grab touch-none select-none items-center justify-between gap-2 rounded-t-xl border-b border-zinc-100 bg-zinc-50 px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">
            {title}
          </div>
          {subtitle ? (
            <div className="truncate text-[11px] text-zinc-500">{subtitle}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดหน้าต่าง"
          className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="overflow-y-auto px-3 py-3">{children}</div>
    </div>,
    document.body,
  );
}
