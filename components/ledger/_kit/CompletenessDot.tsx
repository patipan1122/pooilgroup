// CompletenessDot — จุดสีเล็ก ๆ บอกสถานะ "ภาษีซื้อขอคืนได้ไหม" (เขียว/เหลือง/แดง/เทา).
//
// สี = ผลตรวจ deterministic จาก lib/ledger/recheck.ts (ไม่ใช่ AI):
//   green_full    = เขียว (emerald) — เต็มรูป + ผู้ซื้อตรง + VAT แยก → ขอคืนได้
//   yellow_partial= เหลือง (amber)  — ใบย่อ/ขาด element รอง → ขอใบใหม่
//   red_invalid   = แดง (red)       — ขาดของบังคับ/ผู้ซื้อผิด → ขอคืนไม่ได้
//   undecided     = เทา (zinc)      — ยังไม่ตรวจ (ใบเก่าก่อนฟีเจอร์)
//
// pure presentational client component · tooltip สรุป missing[] เป็นภาษาไทย.
// Reuses the same emerald/amber/red/zinc status palette as ConfidenceTag + Badge (kit-wide).
"use client";

import { cn } from "@/lib/utils/cn";
import type { CompletenessStatus } from "@/lib/ledger/types";

const META: Record<
  CompletenessStatus,
  { dot: string; label: string }
> = {
  green_full: { dot: "bg-emerald-500", label: "ขอคืนภาษีซื้อได้" },
  yellow_partial: { dot: "bg-amber-500", label: "ยังขอคืนไม่ได้ (ต้องขอใบใหม่)" },
  red_invalid: { dot: "bg-red-500", label: "ขอคืนไม่ได้ (ใบไม่สมบูรณ์/ผู้ซื้อผิด)" },
  undecided: { dot: "bg-zinc-300", label: "ยังไม่ตรวจสถานะใบกำกับ" },
};

/** Thai labels for the deterministic `missing[]` element tokens (recheck.ts). */
export const MISSING_LABELS: Record<string, string> = {
  vendor_taxid: "ยังไม่มีเลขภาษีผู้ขาย 13 หลัก — เติมในช่อง “เลขผู้เสียภาษี” (ส่วนที่ 2) แล้วจะขอคืน VAT ได้ (AI อาจอ่านไม่ครบจากรูปที่เอียง/ไม่ชัด)",
  buyer_taxid: "เลขภาษีผู้ซื้อ (เจพีซิ้งค์) ไม่ตรง/ไม่เจอบนใบ",
  vat_line: "ไม่มีบรรทัด VAT แยก",
  vendor_address: "ไม่มีที่อยู่ผู้ขาย",
  vendor_branch: "ไม่ระบุสาขาผู้ขาย",
};

export function missingLabel(token: string): string {
  return MISSING_LABELS[token] ?? token;
}

export function CompletenessDot({
  status,
  missing,
  className,
}: {
  status: CompletenessStatus | string;
  /** element ที่ขาด (จาก recheck.ts) — โชว์ใน tooltip. */
  missing?: string[] | null;
  className?: string;
}) {
  const meta = META[(status as CompletenessStatus)] ?? META.undecided;
  const miss = (missing ?? []).map(missingLabel);
  const title =
    miss.length > 0 ? `${meta.label} · ขาด: ${miss.join(", ")}` : meta.label;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center", className)}
      title={title}
      aria-label={title}
      role="img"
    >
      <span className={cn("size-2 rounded-full ring-2 ring-white", meta.dot)} />
    </span>
  );
}
