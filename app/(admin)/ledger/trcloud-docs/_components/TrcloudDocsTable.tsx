import { FileText } from "lucide-react";
import type { TrcloudDocRow, TrcloudDocKind } from "@/lib/ledger/trcloud-docs-data";

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// สถานะ → สี (ใช้กรอบ/พื้นสีแทนประโยคยาว)
function statusPill(kind: TrcloudDocKind, status: string | null, statusAp: string | null) {
  if (kind === "PO") {
    const converted = statusAp != null && Number(statusAp) > 0;
    return converted
      ? { text: "แปลง AP แล้ว", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
      : { text: status || "ยังไม่แปลง", cls: "bg-sky-50 text-sky-700 ring-sky-200" };
  }
  const s = (status || "").toLowerCase();
  if (s.includes("paid")) return { text: "จ่ายแล้ว", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
  if (s.includes("debtor") || s.includes("unpaid")) return { text: "ค้างจ่าย", cls: "bg-amber-50 text-amber-700 ring-amber-200" };
  return { text: status || "—", cls: "bg-zinc-100 text-zinc-600 ring-zinc-200" };
}

export function TrcloudDocsTable({ rows, kind }: { rows: TrcloudDocRow[]; kind: TrcloudDocKind }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-500">
        ยังไม่มีข้อมูล — กด “รีเฟรชจาก TRCloud” ด้านบนเพื่อดึงเอกสารเข้ามา
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
            <th className="px-3 py-2 font-medium">วันที่</th>
            <th className="px-3 py-2 font-medium">เลขที่</th>
            <th className="px-3 py-2 font-medium">ผู้ขาย</th>
            <th className="px-3 py-2 font-medium">ชุดเลข</th>
            <th className="px-3 py-2 font-medium">นิติบุคคล</th>
            <th className="px-3 py-2 font-medium">สาขา</th>
            <th className="px-3 py-2 text-right font-medium">ยอดรวม</th>
            <th className="px-3 py-2 font-medium">สถานะ</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pill = statusPill(kind, r.status, r.statusAp);
            return (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{r.issueDate ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800">{r.refNo || r.docNumber || "—"}</td>
                <td className="max-w-[240px] px-3 py-2">
                  <div className="truncate text-zinc-800" title={r.vendorName ?? undefined}>{r.vendorName || "—"}</div>
                  {r.invoiceNote && (
                    <div className="truncate text-xs text-zinc-400" title={r.invoiceNote}>{r.invoiceNote}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.companyFormat ? (
                    <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">{r.companyFormat}</span>
                  ) : "—"}
                </td>
                <td className="max-w-[130px] truncate px-3 py-2 text-zinc-600" title={r.department ?? undefined}>{r.department || "—"}</td>
                <td className="max-w-[160px] truncate px-3 py-2 text-zinc-600" title={r.project ?? undefined}>{r.project || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-zinc-800">{money(r.grandTotal ?? r.total)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pill.cls}`}>{pill.text}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {r.pdfUrl ? (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" /> ดูใบ
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
