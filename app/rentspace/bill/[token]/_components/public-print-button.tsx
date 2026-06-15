"use client";

import { Printer } from "lucide-react";

/** Print / save-as-PDF for the public bill view. window.print() only. */
export function PublicPrintButton() {
  return (
    <button type="button" aria-label="พิมพ์ หรือ บันทึกเป็น PDF" className="rs-btn" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> พิมพ์ / บันทึก PDF
    </button>
  );
}
