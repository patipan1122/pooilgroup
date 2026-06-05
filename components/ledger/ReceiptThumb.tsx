// ReceiptThumb — แสดงรูปใบเสร็จ/สลิปแบบ "ย่อเล็ก" (จาก R2) · แตะเพื่อขยายเต็มจอ.
// ใช้ในตาราง multi-pane (ฝั่งขวา) + ฟอร์มแก้ใน LIFF (มือถือ). บนมือถือ touch ไม่มี
// hover → ปุ่มขยายต้องโชว์ตลอด + แตะรูปแล้ว pop เป็น lightbox เต็มจอ (CEO 2026-06-05:
// "รูปให้โชว์เล็กๆพอ กดแล้วค่อย pop"). ไม่มีรูป → placeholder.
"use client";

import { useState } from "react";
import { ImageOff, ExternalLink, ZoomIn, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function ReceiptThumb({
  thumbUrl,
  originalUrl,
  alt = "ใบเสร็จ",
  className,
}: {
  thumbUrl: string | null | undefined;
  originalUrl?: string | null;
  alt?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const src = thumbUrl || originalUrl || null;
  const fullUrl = originalUrl || thumbUrl || null;

  if (!src || broken) {
    return (
      <div
        className={cn(
          "flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-400",
          className,
        )}
      >
        <ImageOff className="size-6" aria-hidden />
        <span className="text-xs">ไม่มีรูปใบเสร็จ</span>
      </div>
    );
  }

  return (
    <>
      {/* รูปย่อเล็ก — แตะเพื่อเปิดเต็มจอ. สูงจำกัด (max-h-44) ไม่กินจอ; ปุ่มขยายโชว์ตลอด (touch). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group relative block w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50",
          className,
        )}
        aria-label="แตะเพื่อดูรูปใบเสร็จเต็มจอ"
      >
        {/* R2 host varies; plain <img> avoids next/image domain config */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="mx-auto max-h-44 w-full object-contain"
        />
        <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
          <ZoomIn className="size-3.5" aria-hidden /> แตะเพื่อขยาย
        </span>
      </button>

      {/* Lightbox เต็มจอ — แตะพื้นหลัง/กากบาทเพื่อปิด; แตะรูปไม่ปิด */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="flex items-center justify-between p-3">
            {fullUrl ? (
              <a
                href={fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur active:bg-white/25"
              >
                <ExternalLink className="size-4" aria-hidden /> เปิดต้นฉบับ
              </a>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="ปิด"
              className="inline-flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur active:bg-white/25"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fullUrl || src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
