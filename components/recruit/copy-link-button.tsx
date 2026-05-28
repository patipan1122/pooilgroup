"use client";

// Copy-to-clipboard button for posting share links
// Used in postings list + posting detail header.

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";

interface Props {
  slug: string;
  size?: "sm" | "md";
}

export function CopyLinkButton({ slug, size = "sm" }: Props) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const url = `${window.location.origin}/apply/${slug}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        toast.success("คัดลอกลิ้งค์แล้ว · ไปแปะใน Facebook/LINE ได้เลย");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast.error("คัดลอกไม่สำเร็จ · ลองอีกครั้ง");
      });
  }

  const h = size === "md" ? "h-10 px-3" : "h-9 w-9";
  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={copy}
      title="คัดลอกลิ้งค์รับสมัคร"
      className={`${h} inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-[var(--color-brand-700)] transition-colors`}
    >
      <Icon className="size-3.5" />
      {size === "md" && (
        <span className="text-xs font-bold">
          {copied ? "คัดลอกแล้ว" : "คัดลอก"}
        </span>
      )}
    </button>
  );
}
