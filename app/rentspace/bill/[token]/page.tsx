// PUBLIC bill view — no auth. Tenants have no app login; the random token IS the
// credential. Mirrors the public sign route (app/sign/rentspace/[token]) which
// also lives OUTSIDE the (admin) group. Read-only A4 invoice + print/save-PDF.

import "@/components/rentspace/tokens.css";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getBillByPublicToken } from "@/lib/rentspace/data";
import { periodLabel } from "@/lib/rentspace/format";
import { BillDocument, BILL_DOC_STYLE } from "@/components/rentspace/bill-document";
import { PublicPrintButton } from "./_components/public-print-button";

export const dynamic = "force-dynamic";

export default async function PublicBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bill = await getBillByPublicToken(token);
  if (!bill) notFound();

  return (
    <div className="rs-scope min-h-screen pb-10" style={{ background: "var(--rs-bg-2)" }}>
      {/* header */}
      <div
        className="px-5 py-5 text-white print:hidden"
        style={{ background: "linear-gradient(135deg, var(--rs-brand), var(--rs-navy))" }}
      >
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-2 text-[13px] opacity-90">
            <FileText className="h-4 w-4" /> ใบแจ้งหนี้ · {bill.project.name}
          </div>
          <h1 className="text-xl font-bold mt-1">
            บิลเลขที่ {bill.billNo} · งวด {periodLabel(bill.period)}
          </h1>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">
        {/* print action */}
        <div className="flex justify-end print:hidden">
          <PublicPrintButton />
        </div>

        {/* A4 invoice */}
        <div className="rs-card p-6">
          <div id="rs-bill">
            <BillDocument bill={bill} />
          </div>
        </div>
      </div>

      <style>{`
        ${BILL_DOC_STYLE}
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          body * { visibility: hidden; }
          #rs-bill, #rs-bill * { visibility: visible; }
          #rs-bill {
            position: absolute;
            inset: 0;
            box-shadow: none !important;
            border: none !important;
          }
          .rs-bill-stamp { top: 0; right: 0; }
        }
      `}</style>
    </div>
  );
}
