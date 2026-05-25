"use client";

// Inline photo lightbox · tap thumbnail to enlarge full-screen.
// No backdrop-blur (W6 constraint for Chrome <80) — solid black overlay.

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface Props {
  url: string;
  alt: string;
}

export function PhotoLightbox({ url, alt }: Props) {
  const [open, setOpen] = useState(false);

  // Escape key dismiss (B6 / B-007 regression).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full overflow-hidden rounded-md ring-1 ring-zinc-200 active:opacity-90"
        aria-label="ขยายภาพเต็มจอ"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className="max-h-96 w-full object-contain"
          loading="lazy"
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white"
            style={{ marginTop: "env(safe-area-inset-top)" }}
            aria-label="ปิด"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            className="max-h-[90vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
