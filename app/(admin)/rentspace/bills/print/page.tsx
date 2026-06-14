// Batch print — renders many bills (one A4 each, page-break between) for
// "พิมพ์หลายห้อง". Reads ?ids=a,b,c, fetches each scoped by orgId, auto-prints.

import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getBill } from "@/lib/rentspace/data";
import { BillDocument, BILL_DOC_STYLE, type BillDocumentData } from "@/components/rentspace/bill-document";
import { AutoPrint } from "./_components/auto-print";

export const dynamic = "force-dynamic";

export default async function BatchPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const ids = (sp.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200); // sane cap

  if (ids.length === 0) notFound();

  // Fetch each scoped by orgId (getBill enforces orgId → anti-IDOR). Drop any
  // id that isn't in this org / doesn't exist, keep requested order.
  const fetched = await Promise.all(ids.map((id) => getBill(orgId, id)));
  const bills = fetched.filter((b): b is NonNullable<typeof b> => b !== null);

  if (bills.length === 0) notFound();

  return (
    <div className="rs-scope min-h-screen" style={{ background: "var(--rs-bg-2)" }}>
      <AutoPrint count={bills.length} />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4 print:max-w-none print:px-0 print:py-0 print:space-y-0">
        <div className="flex items-center justify-between print:hidden">
          <div className="text-[13.5px]" style={{ color: "var(--rs-text-2)" }}>
            พิมพ์ทั้งหมด {bills.length} ใบ — หน้าต่างพิมพ์จะเปิดอัตโนมัติ
          </div>
        </div>

        {bills.map((bill) => (
          <div key={bill.id} className="rs-card p-6 rs-print-page print:rounded-none print:shadow-none">
            <BillDocument bill={bill as BillDocumentData} />
          </div>
        ))}
      </div>

      <style>{`
        ${BILL_DOC_STYLE}
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          .rs-print-page {
            break-inside: avoid;
            page-break-after: always;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
          .rs-print-page:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
