"use client";

// Slip viewer — click a deposit amount or the "สลิป" badge in the reconcile
// ledger to pop the deposit slip image up full-screen (CEO 2026-06-03).
// Non-modal-feel lightbox: dark overlay, click-outside / Esc / X to close.
// The ledger table itself is a server component, so these are the small
// client islands it embeds for the two interactive cells.

import { Paperclip, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

function isImageUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

function Lightbox({
  url,
  caption,
  onClose,
}: {
  url: string;
  caption: string;
  onClose: () => void;
}) {
  // Esc closes — keyboard parity with click-outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ดูสลิปฝากเงินเต็มจอ"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20"
        aria-label="ปิด"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      <div
        className="relative max-h-[90vh] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* unoptimized: R2 URLs aren't in next/image remotePatterns */}
        <Image
          src={url}
          alt={caption}
          width={1400}
          height={1900}
          className="max-h-[90vh] w-auto rounded-lg object-contain"
          unoptimized
        />
        <span className="absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-1 text-center font-mono text-xs text-white">
          {caption}
        </span>
      </div>
    </div>
  );
}

/** "สลิป" column cell — clickable badge when a real slip image exists. */
export function SlipBadge({
  url,
  missing,
  caption,
}: {
  /** Real image URL, the literal "slip" placeholder, or null. */
  url: string | null;
  /** CSV import row that has no slip yet → amber warning. */
  missing: boolean;
  caption: string;
}) {
  const [open, setOpen] = useState(false);

  if (isImageUrl(url)) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rc-slip"
          aria-label="ดูสลิปฝากเงิน"
        >
          <Paperclip size={11} aria-hidden="true" /> สลิป
        </button>
        {open && (
          <Lightbox url={url} caption={caption} onClose={() => setOpen(false)} />
        )}
      </>
    );
  }
  if (missing) {
    return (
      <span
        title="CSV import ยังไม่มี slipUrl"
        className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
      >
        ยังไม่มีสลิป
      </span>
    );
  }
  if (url) {
    // collection exists but no photo attached
    return (
      <span className="text-muted" title="ไม่มีรูปสลิปแนบ">
        สลิป
      </span>
    );
  }
  return <span className="text-muted">—</span>;
}

/** "ฝาก" column cell — the deposit amount; click opens the slip image. */
export function DepositAmount({
  amount,
  slipUrl,
  caption,
}: {
  /** Pre-formatted amount string (e.g. "1,710"). */
  amount: string;
  slipUrl: string | null;
  caption: string;
}) {
  const [open, setOpen] = useState(false);

  if (isImageUrl(slipUrl)) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rc-deposit-link"
          aria-label="ดูสลิปฝากเงิน"
          title="กดเพื่อดูสลิปฝากเงิน"
        >
          {amount}
        </button>
        {open && (
          <Lightbox
            url={slipUrl}
            caption={caption}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  return <>{amount}</>;
}
