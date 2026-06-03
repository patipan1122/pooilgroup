"use client";

// LedgerLine — Brand kit (Logo + Mascot). SINGLE SOURCE so swapping art is
// one place: drop the real files into public/ledger/brand/ and these update
// everywhere (web header, LIFF hero, empty states).
//
// SWAP SLOTS (CEO drops real files here):
//   • Logo   → public/ledger/brand/logo.svg   (PNG override: logo.png)
//   • Mascot → public/ledger/brand/mascot.svg (PNG override: mascot.png)
//
// PNG-over-SVG preference: we try the .png first; if it doesn't exist the
// browser's onError swaps to the committed .svg placeholder. So the CEO can
// add a PNG without touching code, and we always have a tasteful fallback.
//
// "use client" only because we use the onError fallback handler. The components
// are otherwise pure presentational and safe to drop into any page (the parent
// Server Component just renders the client island).

import { useState } from "react";

const BASE = "/ledger/brand";

/** Try PNG first → fall back to the committed SVG placeholder on 404. */
function BrandImg({
  name,
  alt,
  className,
  width,
  height,
  priority,
}: {
  name: "logo" | "mascot";
  alt: string;
  className?: string;
  width: number;
  height: number;
  priority?: boolean;
}) {
  // Start with PNG (CEO override); swap to SVG placeholder if it isn't there.
  const [src, setSrc] = useState(`${BASE}/${name}.png`);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => {
        // PNG missing → use the SVG placeholder (guaranteed to exist in repo).
        if (!src.endsWith(".svg")) setSrc(`${BASE}/${name}.svg`);
      }}
    />
  );
}

const LOGO_RATIO = 168 / 32; // matches public/ledger/brand/logo.svg viewBox

/**
 * LedgerLogo — JP Sync Group wordmark. Height-driven (width derives from the
 * placeholder ratio); a real logo of any width still renders cleanly because we
 * only fix the height and let width be auto via the ratio hint.
 */
export function LedgerLogo({
  height = 28,
  className,
  priority,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <BrandImg
      name="logo"
      alt="JP Sync Group"
      width={Math.round(height * LOGO_RATIO)}
      height={height}
      className={["w-auto", className].filter(Boolean).join(" ")}
      priority={priority}
    />
  );
}

/**
 * LedgerMascot — "น้องใบเสร็จ", the friendly receipt character. Square.
 * Use in LIFF hero + empty states to warm up the otherwise text-only screens.
 */
export function LedgerMascot({
  size = 64,
  className,
  priority,
  alt = "น้องใบเสร็จ ผู้ช่วยบันทึกค่าใช้จ่าย",
}: {
  size?: number;
  className?: string;
  priority?: boolean;
  alt?: string;
}) {
  return (
    <BrandImg
      name="mascot"
      alt={alt}
      width={size}
      height={size}
      className={["select-none", className].filter(Boolean).join(" ")}
      priority={priority}
    />
  );
}

/**
 * LedgerEmptyState — mascot + warm one-liner, replacing plain "ยังไม่มีข้อมูล"
 * text so empty screens feel friendly, not scary. Keep copy short + kind.
 */
export function LedgerEmptyState({
  title,
  hint,
  mascotSize = 72,
  action,
  className,
}: {
  title: string;
  hint?: string;
  mascotSize?: number;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-3 px-4 py-10 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <LedgerMascot size={mascotSize} />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-700">{title}</p>
        {hint && <p className="text-xs text-zinc-400">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
