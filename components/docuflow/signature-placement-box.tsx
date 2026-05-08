"use client";

// SignaturePlacementBox — draggable + resizable signature box overlay.
// ────────────────────────────────────────────────────────────────────
// Used inside the SignaturePlacementEditor on top of a rendered PDF
// page. All coordinates come in / go out as 0..1 ratios (top-left
// origin) so they map cleanly onto whatever the page is currently
// rendered at.
//
// UX:
//   - Drag anywhere on the body to move the box.
//   - Drag the corner handle (bottom-right) to resize.
//   - Stays clamped inside [0..1] on both axes.
//   - Click to "select" (parent drives selection); selected boxes
//     show their action chrome (role + delete).
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface PlacementRect {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface SignaturePlacementBoxProps {
  /** Stable id (used for keys + selection state). */
  id: string;
  /** Current normalized rectangle. */
  rect: PlacementRect;
  /** Caption rendered inside the box (e.g. "เจ้าของเซ็น"). */
  label?: string | null;
  /** Tone label rendered as a small chip. */
  roleLabel: string;
  /** Whether a signature has already been captured for this box. */
  signed?: boolean;
  /** True when this box is the selected one (parent-controlled). */
  selected?: boolean;
  /** Container size in CSS pixels; required to translate ratios → pixels. */
  containerWidth: number;
  containerHeight: number;
  onSelect?: () => void;
  onChange?: (next: PlacementRect) => void;
  onDelete?: () => void;
  /** Read-only mode — disables drag/resize/delete (e.g. signer view). */
  readOnly?: boolean;
}

const MIN_W = 0.05;
const MIN_H = 0.025;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function SignaturePlacementBox({
  id,
  rect,
  label,
  roleLabel,
  signed,
  selected,
  containerWidth,
  containerHeight,
  onSelect,
  onChange,
  onDelete,
  readOnly,
}: SignaturePlacementBoxProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Ephemeral drag state — not React-managed for perf
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    initRect: PlacementRect;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const px = {
    left: rect.xRatio * containerWidth,
    top: rect.yRatio * containerHeight,
    width: rect.widthRatio * containerWidth,
    height: rect.heightRatio * containerHeight,
  };

  // Stash the latest closure (which sees current props) inside a ref
  // updated via useEffect, then expose stable wrappers as event handlers.
  // This pattern keeps add/remove listener pairs identical without
  // hitting React's "no ref writes during render" / "use-before-declare"
  // pitfalls.
  const moveLatestRef = useRef<(e: PointerEvent) => void>(() => {});
  const stopLatestRef = useRef<() => void>(() => {});

  useEffect(() => {
    moveLatestRef.current = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / containerWidth;
      const dy = (e.clientY - drag.startY) / containerHeight;
      if (drag.mode === "move") {
        const nx = clamp(
          drag.initRect.xRatio + dx,
          0,
          1 - drag.initRect.widthRatio,
        );
        const ny = clamp(
          drag.initRect.yRatio + dy,
          0,
          1 - drag.initRect.heightRatio,
        );
        onChange?.({
          xRatio: nx,
          yRatio: ny,
          widthRatio: drag.initRect.widthRatio,
          heightRatio: drag.initRect.heightRatio,
        });
      } else {
        const nw = clamp(
          drag.initRect.widthRatio + dx,
          MIN_W,
          1 - drag.initRect.xRatio,
        );
        const nh = clamp(
          drag.initRect.heightRatio + dy,
          MIN_H,
          1 - drag.initRect.yRatio,
        );
        onChange?.({
          xRatio: drag.initRect.xRatio,
          yRatio: drag.initRect.yRatio,
          widthRatio: nw,
          heightRatio: nh,
        });
      }
    };
  });

  // Stable identities for add/remove listener
  const moveHandler = useCallback((e: PointerEvent) => {
    moveLatestRef.current(e);
  }, []);
  const stopHandler = useCallback(() => {
    stopLatestRef.current();
  }, []);

  useEffect(() => {
    stopLatestRef.current = () => {
      dragRef.current = null;
      setIsDragging(false);
      window.removeEventListener("pointermove", moveHandler);
      window.removeEventListener("pointerup", stopHandler);
      window.removeEventListener("pointercancel", stopHandler);
    };
  }, [moveHandler, stopHandler]);

  useEffect(() => {
    const moveH = moveHandler;
    const stopH = stopHandler;
    return () => {
      // Clean up listeners if the box unmounts mid-drag
      window.removeEventListener("pointermove", moveH);
      window.removeEventListener("pointerup", stopH);
      window.removeEventListener("pointercancel", stopH);
    };
  }, [moveHandler, stopHandler]);

  function startDrag(
    e: React.PointerEvent<HTMLElement>,
    mode: "move" | "resize",
  ) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initRect: { ...rect },
    };
    setIsDragging(true);
    window.addEventListener("pointermove", moveHandler);
    window.addEventListener("pointerup", stopHandler);
    window.addEventListener("pointercancel", stopHandler);
  }

  return (
    <div
      ref={wrapRef}
      data-placement-id={id}
      onPointerDown={(e) => startDrag(e, "move")}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      style={{
        position: "absolute",
        left: px.left,
        top: px.top,
        width: px.width,
        height: px.height,
      }}
      className={cn(
        "rounded-md border-2 transition-shadow",
        readOnly ? "cursor-default" : "cursor-move",
        isDragging && "shadow-lg",
        signed
          ? "border-green-500 bg-green-50/70"
          : selected
            ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)]/80 ring-2 ring-[var(--color-brand-300)]"
            : "border-[var(--color-brand-500)]/70 bg-white/70 hover:bg-white",
      )}
    >
      {/* Top chrome: role chip + label + delete */}
      <div className="absolute -top-7 left-0 right-0 flex items-center justify-between gap-2 text-[11px] font-medium pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              signed
                ? "bg-green-600 text-white"
                : "bg-[var(--color-brand-600)] text-white",
            )}
          >
            {roleLabel}
          </span>
          {label && (
            <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-zinc-700 border border-zinc-200 truncate max-w-[180px]">
              {label}
            </span>
          )}
        </div>
        {!readOnly && onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="pointer-events-auto inline-flex items-center justify-center size-5 rounded-md bg-white/90 text-zinc-500 hover:text-red-600 hover:bg-red-50 border border-zinc-200"
            aria-label="ลบจุดเซ็น"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>

      {/* Body — drag-grip indicator centered */}
      <div className="w-full h-full flex items-center justify-center text-zinc-400 pointer-events-none select-none">
        <GripHorizontal className="size-4" />
      </div>

      {/* Resize handle (bottom-right) */}
      {!readOnly && (
        <div
          onPointerDown={(e) => startDrag(e, "resize")}
          className="absolute right-0 bottom-0 translate-x-1/3 translate-y-1/3 size-4 rounded-full bg-[var(--color-brand-600)] border-2 border-white shadow cursor-nwse-resize"
          aria-label="ปรับขนาด"
        />
      )}
    </div>
  );
}
