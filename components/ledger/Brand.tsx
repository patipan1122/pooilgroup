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

/** The mascot "JP" poses available in public/ledger/brand/mascot/. */
export type MascotPose =
  | "welcome"
  | "receipt"
  | "money"
  | "camera"
  | "typing"
  | "confused"
  | "explain"
  | "alert"
  | "sleepy"
  | "celebrate";

/** Render an image trying a chain of srcs (swap to next on error). */
function FallbackImg({
  srcs,
  alt,
  className,
  width,
  height,
  priority,
}: {
  srcs: string[];
  alt: string;
  className?: string;
  width: number;
  height: number;
  priority?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={srcs[idx]}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => {
        if (idx < srcs.length - 1) setIdx(idx + 1);
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
    <FallbackImg
      srcs={[`${BASE}/logo.png`, `${BASE}/logo.svg`]}
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
  pose = "welcome",
  size = 64,
  className,
  priority,
  alt = "น้องใบเสร็จ ผู้ช่วยบันทึกค่าใช้จ่าย",
}: {
  pose?: MascotPose;
  size?: number;
  className?: string;
  priority?: boolean;
  alt?: string;
}) {
  return (
    <FallbackImg
      // pose poses live in /ledger/brand/mascot/<pose>(-sm).png; fall back to the
      // committed mascot.svg placeholder if a pose isn't deployed yet.
      srcs={[
        `${BASE}/mascot/${pose}-sm.png`,
        `${BASE}/mascot/${pose}.png`,
        `${BASE}/mascot.svg`,
      ]}
      alt={alt}
      width={size}
      height={size}
      className={["select-none object-contain", className].filter(Boolean).join(" ")}
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
  pose = "explain",
  action,
  className,
}: {
  title: string;
  hint?: string;
  mascotSize?: number;
  pose?: MascotPose;
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
      <LedgerMascot pose={pose} size={mascotSize} />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-700">{title}</p>
        {hint && <p className="text-xs text-zinc-400">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
