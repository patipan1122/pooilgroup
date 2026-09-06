"use client";

// Copy + share buttons for posting apply links
// Used in postings list + posting detail header.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Check, Share2 } from "lucide-react";

interface Props {
  slug: string;
  size?: "sm" | "md";
}

function applyUrl(slug: string): string {
  // Lock the shared link to the public domain (pooilgroup.com) instead of
  // window.location.origin — otherwise, if HR opens the back-office via
  // pooilgroup.vercel.app, the shared apply link gets frozen with "vercel".
  const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  return `${base}/apply/${slug}`;
}

export function CopyLinkButton({ slug, size = "sm" }: Props) {
  const [copied, setCopied] = useState(false);
  // Detect after mount only — `navigator` isn't available during SSR and
  // checking it during render would mismatch the server-rendered markup.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  function copy() {
    navigator.clipboard
      .writeText(applyUrl(slug))
      .then(() => {
        setCopied(true);
        toast.success("คัดลอกลิ้งค์แล้ว · ไปแปะใน Facebook/LINE ได้เลย");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast.error("คัดลอกไม่สำเร็จ · ลองอีกครั้ง");
      });
  }

  function share() {
    navigator
      .share({ title: "ประกาศรับสมัครงาน", url: applyUrl(slug) })
      .catch(() => {
        // User cancelled the share sheet — not an error, stay silent.
      });
  }

  const h = size === "md" ? "h-10 px-3" : "h-9 w-9";
  const CopyIcon = copied ? Check : Copy;

  return (
    <div className="inline-flex items-center gap-1.5">
      {canShare && (
        <button
          type="button"
          onClick={share}
          title="แชร์ลิงก์รับสมัคร"
          className={`${h} inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-[var(--color-brand-700)] transition-colors`}
        >
          <Share2 className="size-3.5" />
          {size === "md" && <span className="text-xs font-bold">แชร์</span>}
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        title="คัดลอกลิ้งค์รับสมัคร"
        className={`${h} inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-[var(--color-brand-700)] transition-colors`}
      >
        <CopyIcon className="size-3.5" />
        {size === "md" && (
          <span className="text-xs font-bold">
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </span>
        )}
      </button>
    </div>
  );
}
