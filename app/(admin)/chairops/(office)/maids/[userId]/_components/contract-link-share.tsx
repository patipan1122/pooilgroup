"use client";

// "ส่งลิงก์สัญญา" — office hands the maid a direct link to her own signing page
// (CEO 2026-09-22).
//
// Deliberately NOT a public/anonymous token: the CEO confirmed every maid who
// needs this already has a login (existing maids sign in normally; brand-new
// hires arrive through the existing LINE invite and are forwarded here right
// after onboarding). So the link is just the ordinary authenticated route — it
// opens the maid's own contract for whoever is signed in, and shows nothing to
// anyone else. That keeps ID-card photos, selfies and bank details behind the
// same auth wall as the rest of the app.

import { useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";

const CONTRACT_PATH = "/chairops/m/contract";

export function ContractLinkShare({
  maidName,
  status,
}: {
  maidName: string;
  status: "none" | "draft" | "signed";
}) {
  const [copied, setCopied] = useState(false);

  // Built client-side so it carries whatever host the office is actually on
  // (prod domain vs preview) instead of a hardcoded one.
  const link =
    typeof window === "undefined" ? CONTRACT_PATH : `${window.location.origin}${CONTRACT_PATH}`;

  const message =
    `สวัสดีค่ะคุณ${maidName} — รบกวนเปิดลิงก์นี้เพื่อเซ็นสัญญาจ้างออนไลน์ค่ะ\n` +
    `${link}\n` +
    `(ล็อกอินด้วย LINE เดิมที่ใช้กับระบบได้เลย)`;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (insecure context) — no-op */
    }
  };

  if (status === "signed") return null;

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
        <MessageCircle className="size-3.5 text-zinc-500" /> ส่งลิงก์ให้แม่บ้านเซ็นเอง
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        คัดลอกข้อความแล้ววางส่งใน LINE ได้เลย · แม่บ้านต้องล็อกอินด้วยบัญชีตัวเองก่อนถึงจะเห็นสัญญา
        คนอื่นเปิดลิงก์นี้จะไม่เห็นข้อมูลของเธอ
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-zinc-200 bg-white px-2 py-1.5 text-[11px] text-zinc-600">
          {link}
        </code>
        <button
          type="button"
          onClick={() => copy(message)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-600" /> คัดลอกแล้ว
            </>
          ) : (
            <>
              <Copy className="size-3" /> คัดลอกข้อความ
            </>
          )}
        </button>
      </div>
    </div>
  );
}
