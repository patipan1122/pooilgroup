"use client";

// Office view of a maid contract (F4b · CEO 2026-08-02) — read-only render of
// the signed (or draft) document with a print / save-PDF action. ADMIN-gated by
// the page (PDPA: shows full ID number + address + signature).

import { Printer } from "lucide-react";
import { ContractDocument } from "@/app/(admin)/chairops/(maid)/m/contract/contract-document";
import type {
  ContractDocData,
  ContractSignature,
} from "@/app/(admin)/chairops/(maid)/m/contract/types";

export function OfficeContractView({
  data,
  signature,
  signed,
}: {
  data: ContractDocData;
  signature: ContractSignature | null;
  signed: boolean;
}) {
  return (
    <div className="space-y-4">
      <div
        className={
          "flex items-center justify-between rounded-xl border px-4 py-3 " +
          (signed
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50")
        }
      >
        <div className={"text-sm font-medium " + (signed ? "text-emerald-800" : "text-amber-800")}>
          {signed ? "สัญญาเซ็นเรียบร้อยแล้ว ✓" : "ร่างสัญญา · ยังไม่เซ็น (รอแม่บ้านเซ็นในแอป)"}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 print:hidden"
        >
          <Printer className="size-4" /> พิมพ์ / บันทึก PDF
        </button>
      </div>

      <div id="contract-print" className="rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
        <ContractDocument data={data} signature={signature} />
      </div>
    </div>
  );
}
