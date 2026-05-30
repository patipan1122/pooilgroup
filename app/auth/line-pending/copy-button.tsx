"use client";

import { useState } from "react";

export function CopyLineIdButton({ lineUserId }: { lineUserId: string }) {
  const [copied, setCopied] = useState(false);
  if (!lineUserId) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(lineUserId).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="h-12 w-full rounded-md bg-emerald-600 text-base font-semibold text-white active:bg-emerald-700"
    >
      {copied ? "คัดลอกแล้ว ✓" : "คัดลอก LINE ID"}
    </button>
  );
}
