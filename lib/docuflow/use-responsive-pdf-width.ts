"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Measures a container's rendered content width via ResizeObserver and
 * returns a PDF page width clamped to `maxWidth`.
 * ────────────────────────────────────────────────────────────────────
 * The PDF viewers (admin placement editor, signer document preview,
 * signer interface) used to pass a hardcoded `width={720}` straight to
 * react-pdf's <Page>, with the wrapping container set to
 * `overflow-hidden`. On mobile viewports (~360-430px) that silently
 * clipped the page — nothing scrolled, nothing shrank, the rest of the
 * document was just gone (CEO click-report 2026-10-07).
 *
 * This hook makes the page width track the container's actual CSS
 * pixel width instead, capped at `maxWidth` so desktop keeps its
 * original fixed size. Pair with `overflow-auto` (not `-hidden`) on the
 * container as a scroll safety net in case the measured width is ever
 * exceeded for any reason (e.g. a brief 0-width frame before the first
 * ResizeObserver callback fires).
 *
 * Placement-dot coordinates are unaffected by this change — they are
 * stored as 0..1 ratios and converted to pixels against the *rendered*
 * page size (see SignaturePlacementBox's own containerWidth/
 * containerHeight props, sourced from a separate ResizeObserver that
 * watches the overlay sitting directly on top of the PDF canvas) — so
 * dots stay correctly positioned at whatever width this hook picks.
 */
export function useResponsivePdfWidth(
  containerRef: RefObject<HTMLDivElement | null>,
  maxWidth = 720,
): number {
  const [width, setWidth] = useState(maxWidth);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(Math.min(w, maxWidth));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, maxWidth]);

  return width;
}
