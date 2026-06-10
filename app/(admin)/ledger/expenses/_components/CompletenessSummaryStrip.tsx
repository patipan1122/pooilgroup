"use client";

// CompletenessSummaryStrip — บรรทัดสรุป "เงินที่ยังติด" เหนือรายการ.
//   เดิมเป็นการ์ดสี 3 ใบ (ขอคืนได้/ขอใบใหม่/ขอคืนไม่ได้) แต่ตัวกรองสี (cc) อยู่ใน
//   "ตัวกรอง" อยู่แล้ว → การ์ดสีซ้ำซ้อน + กินพื้นที่ (CEO 2026-06-06). เหลือแค่
//   ยอด VAT ที่ยัง "ติด" + จำนวนใบที่ยังไม่ตรวจ เป็นบรรทัดเล็ก ๆ บรรทัดเดียว.

import { ShieldAlert } from "lucide-react";
import type { CompletenessSummary } from "@/lib/ledger/queries";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function CompletenessSummaryStrip({
  summary,
}: {
  summary: CompletenessSummary;
  /** kept for call-site compatibility (no longer used after the declutter). */
  baseParams?: string;
  selectedId?: string;
  cc?: "green" | "yellow" | "red";
}) {
  const { counts, blockedVat } = summary;
  const graded = counts.green_full + counts.yellow_partial + counts.red_invalid;
  // ไม่มีใบที่ตรวจแล้ว + ไม่มี VAT ติด → ไม่ต้องโชว์ (กันรกหน้าใบเก่าล้วน).
  if (graded === 0 && counts.undecided === 0) return null;
  if (blockedVat <= 0 && counts.undecided === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      {blockedVat > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1">
          <ShieldAlert className="size-3.5 shrink-0 text-amber-600" aria-hidden />
          <span className="font-bold tabular-nums text-amber-800">{baht(blockedVat)}</span>
          <span className="text-amber-700">VAT ติด</span>
        </span>
      )}
      {counts.undecided > 0 && (
        <span className="text-[11px] text-zinc-500">
          อีก {counts.undecided.toLocaleString("en-US")} ใบยังไม่ตรวจ (เปิดแล้วกดบันทึกจะตรวจให้)
        </span>
      )}
    </div>
  );
}
