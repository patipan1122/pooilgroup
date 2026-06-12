"use client";

// PeriodLockBanner — sticky banner shown when a batch is locked.
// Displays SHA-256 fingerprint (first 16 chars + "...") for CPA verification.
// Sticky at top of the Match page when locked.

import { Lock } from "lucide-react";

interface Props {
  lockedAt: string;    // ISO timestamp
  fingerprint: string; // SHA-256 hex
  lockedBy?: string;   // display name (optional)
}

export function PeriodLockBanner({ lockedAt, fingerprint, lockedBy }: Props) {
  const date = new Date(lockedAt).toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const shortFp = `${fingerprint.slice(0, 16)}...`;

  return (
    <div className="sticky top-0 z-10 mb-4 flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800 shadow-sm">
      <Lock size={14} className="shrink-0" />
      <span className="font-semibold">งวดบัญชีล็อคแล้ว</span>
      <span className="text-purple-600">—</span>
      <span>{date}</span>
      {lockedBy && <span className="text-purple-500">โดย {lockedBy}</span>}
      <span className="ml-auto font-mono text-xs text-purple-500" title={fingerprint}>
        {shortFp}
      </span>
    </div>
  );
}
