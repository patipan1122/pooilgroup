"use client";

import { Download } from "lucide-react";

/** ปุ่มพิมพ์/เซฟ PDF สำหรับรายงานสรุป — เหมือน PrintBillButton ของใบวางบิลเดี่ยว. */
export function PrintSummaryButton() {
  return (
    <button
      type="button"
      className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0"
      onClick={() => window.print()}
    >
      <Download className="h-4 w-4" /> ดาวน์โหลด / พิมพ์ PDF
    </button>
  );
}
