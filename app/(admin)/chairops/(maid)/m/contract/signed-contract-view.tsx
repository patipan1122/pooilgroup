"use client";

// Read-only view of a SIGNED maid contract + print/save-PDF action.

import { Printer } from "lucide-react";
import { ContractDocument } from "./contract-document";
import type { ContractDocData, ContractSignature } from "./types";

export function SignedContractView({
  data,
  signature,
}: {
  data: ContractDocData;
  signature: ContractSignature;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="text-sm font-medium text-emerald-800">
          สัญญาเซ็นเรียบร้อยแล้ว ✓
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 active:bg-emerald-100 print:hidden"
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
