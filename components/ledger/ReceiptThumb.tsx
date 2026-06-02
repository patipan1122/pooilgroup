// ReceiptThumb — แสดงรูปใบเสร็จ/สลิป (thumbnail จาก R2) พร้อมลิงก์เปิดต้นฉบับ.
// ใช้ในตาราง multi-pane (ฝั่งขวา) + การ์ดรายการ.
// ถ้าไม่มีรูป → แสดง placeholder (เคสที่มาจาก web upload ที่ยังไม่แนบรูป).
"use client";

import { useState } from "react";
import { ImageOff, ExternalLink, ZoomIn } from "lucide-react";
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
  const src = thumbUrl || originalUrl || null;
  const fullUrl = originalUrl || thumbUrl || null;

  if (!src || broken) {
    return (
      <div
        className={cn(
          "flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-400",
          className,
        )}
      >
        <ImageOff className="size-8" aria-hidden />
        <span className="text-xs">ไม่มีรูปใบเสร็จ</span>
      </div>
    );
  }

  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50", className)}>
      {/* R2 host varies; plain <img> avoids next/image domain config */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-auto w-full object-contain"
      />
      {fullUrl && (
        <a
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
        >
          <ZoomIn className="size-3.5" aria-hidden />
          เปิดเต็ม
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </div>
  );
}
