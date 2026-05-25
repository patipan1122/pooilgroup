"use client";

// PhotoProofPanel · sticky right-rail photo proof viewer.
// Spec: AUDIT_chairops_2026-05-25 §6.photo tokens.
//
// Used in reconcile/[branch] detail + damage detail. Shows photo thumb +
// watermark info (datetime/branch/user) + click-to-lightbox. Empty state
// when no photo available.

import { cn } from "@/lib/utils/cn";
import { ImageOff, X, ZoomIn } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

export interface PhotoProof {
  /** Full image URL (R2 signed URL). */
  url: string;
  /** Human-readable timestamp e.g. "12 พ.ค. 2569 · 14:32". */
  takenAt: string;
  /** Branch name to overlay as watermark info. */
  branchName: string;
  /** User who uploaded (e.g. "แม่บ้าน · สมหญิง"). */
  uploadedBy: string;
  /** Optional description / context (e.g. "หลักฐานเก็บเงินรอบ 14:00"). */
  caption?: string;
}

export interface PhotoProofPanelProps {
  photo?: PhotoProof | null;
  /** Title above the panel. */
  title?: string;
  /** Sticky behavior — disable for inline use. */
  sticky?: boolean;
  className?: string;
}

export function PhotoProofPanel({
  photo,
  title = "หลักฐานภาพ",
  sticky = true,
  className,
}: PhotoProofPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-background p-3",
        sticky && "sticky top-20",
        className,
      )}
      aria-label={title}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {photo && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="ขยายภาพเต็มจอ"
          >
            <ZoomIn className="size-3.5" aria-hidden="true" />
            ขยาย
          </button>
        )}
      </div>

      {photo ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative overflow-hidden rounded-md ring-1 ring-border"
            aria-label="กดเพื่อขยายภาพ"
          >
            <div className="relative aspect-video w-full bg-zinc-100">
              <Image
                src={photo.url}
                alt={photo.caption ?? "หลักฐานภาพ"}
                fill
                sizes="(max-width: 768px) 100vw, 360px"
                className="object-cover"
                unoptimized
              />
            </div>
            <span className="absolute bottom-2 left-2 right-2 rounded bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white/80">
              {photo.branchName} · {photo.takenAt}
            </span>
          </button>

          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
            <dt className="text-zinc-500">เวลา</dt>
            <dd className="font-medium text-zinc-800">{photo.takenAt}</dd>
            <dt className="text-zinc-500">สาขา</dt>
            <dd className="font-medium text-zinc-800">{photo.branchName}</dd>
            <dt className="text-zinc-500">โดย</dt>
            <dd className="font-medium text-zinc-800">{photo.uploadedBy}</dd>
            {photo.caption && (
              <>
                <dt className="text-zinc-500">หมายเหตุ</dt>
                <dd className="text-zinc-700">{photo.caption}</dd>
              </>
            )}
          </dl>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-md bg-zinc-50 px-4 py-8 text-center">
          <ImageOff className="size-8 text-zinc-400" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-600">ไม่มีหลักฐานภาพ</p>
          <p className="text-xs text-zinc-500">
            แม่บ้านยังไม่ได้แนบภาพประกอบ
          </p>
        </div>
      )}

      {open && photo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="ดูภาพเต็มจอ"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20"
            aria-label="ปิด"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
          <div
            className="relative max-h-[90vh] max-w-[95vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={photo.url}
              alt={photo.caption ?? "หลักฐานภาพ"}
              width={1600}
              height={1200}
              className="max-h-[90vh] w-auto rounded-lg object-contain"
              unoptimized
            />
            <span className="absolute bottom-2 left-2 right-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-white">
              {photo.branchName} · {photo.takenAt} · {photo.uploadedBy}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
