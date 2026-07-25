"use client";
import { useEffect, useState } from "react";
import { X, FileText, AlertTriangle, Loader2 } from "lucide-react";
import { actReadTrcloudDocDetail } from "../actions";
import type { TrcloudDocDetail } from "@/lib/ledger/trcloud-doc-detail";
import type { TrcloudDocRow } from "@/lib/ledger/trcloud-docs-data";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// แผง "ไส้ใน" ของใบเดียว — เปิดจากการคลิกแถวในตาราง (อ่านสดจาก TRCloud ตอนเปิด).
export function DocDetailDrawer({ doc, onClose }: { doc: TrcloudDocRow | null; onClose: () => void }) {
  // ผูกผลลัพธ์กับ id ของใบ → ไม่โชว์ไส้ในของใบเก่าตอนสลับใบ (loading = ยังไม่มีผลของใบนี้)
  const [state, setState] = useState<{ id: string; detail: TrcloudDocDetail | null }>({ id: "", detail: null });

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    actReadTrcloudDocDetail(doc.kind, doc.trcloudId, doc.refNo).then((d) => {
      if (!cancelled) setState({ id: doc.id, detail: d });
    });
    return () => { cancelled = true; };
  }, [doc]);

  // ปิดด้วย Esc
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, onClose]);

  if (!doc) return null;

  const detail = state.id === doc.id ? state.detail : null;
  const loading = detail === null;

  const h = detail?.header;
  const grand = h?.grandTotal ?? doc.grandTotal ?? doc.total;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* backdrop */}
      <button aria-label="ปิด" onClick={onClose} className="absolute inset-0 bg-zinc-900/30" />
      {/* panel */}
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        {/* header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${doc.fromLedger ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-zinc-100 text-zinc-500 ring-zinc-200"}`}>
                {doc.fromLedger ? "● จากเรา" : "○ TRCloud"}
              </span>
              <span className="text-xs text-zinc-400">{doc.kind}</span>
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-zinc-900">
              {doc.refNo || doc.docNumber || "—"}
            </h2>
            <p className="truncate text-xs text-zinc-500">{doc.vendorName || "—"} · {doc.issueDate ?? "—"}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* body (scroll) */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* ยอดเงิน */}
          <section className="rounded-xl border border-zinc-200 p-3">
            <div className="grid grid-cols-2 gap-y-1.5 text-sm">
              <span className="text-zinc-500">ก่อน VAT</span>
              <span className="text-right text-zinc-800">{money(h?.total ?? (doc.total != null && doc.tax != null ? doc.total - doc.tax : null))}</span>
              <span className="text-zinc-500">VAT</span>
              <span className="text-right text-zinc-800">
                {doc.hasVat ? money(doc.tax) : <span className="text-zinc-400">ไม่มี VAT</span>}
              </span>
              {(h?.wht ?? doc.wht) ? (
                <>
                  <span className="text-zinc-500">หัก ณ ที่จ่าย</span>
                  <span className="text-right text-amber-700">{money(h?.wht ?? doc.wht)}</span>
                </>
              ) : null}
              <span className="border-t border-zinc-100 pt-1.5 font-medium text-zinc-600">ยอดรวม</span>
              <span className="border-t border-zinc-100 pt-1.5 text-right font-semibold text-zinc-900">{money(grand)}</span>
            </div>
          </section>

          {/* หมวดที่เราตั้ง (● เท่านั้น) */}
          {doc.fromLedger && (doc.ourCategoryName || doc.ourAccCode) && (
            <section className="rounded-xl bg-emerald-50/60 px-3 py-2 text-sm ring-1 ring-inset ring-emerald-100">
              <div className="text-xs font-medium text-emerald-700">หมวดที่เราตั้ง (LedgerLine)</div>
              <div className="mt-0.5 text-zinc-800">
                {doc.ourCategoryName || "—"}
                {doc.ourAccCode && <span className="ml-1 text-zinc-500">· {doc.ourAccCode}{doc.ourAccName ? ` ${doc.ourAccName}` : ""}</span>}
              </div>
            </section>
          )}

          {/* การลงบัญชีจริง (Dr/Cr) */}
          <section>
            <div className="mb-1.5 text-sm font-medium text-zinc-700">การลงบัญชีจริงใน TRCloud</div>
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-4 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังอ่านจาก TRCloud…
              </div>
            ) : detail?.hasUnclassified ? (
              <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>ใบนี้ถูกลงบัญชีเป็น <b>5919999 รายจ่ายยังไม่ได้แยกประเภท</b> — ควรแก้หมวดให้ถูกต้อง</span>
              </div>
            ) : null}

            {detail && detail.journal.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-zinc-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                      <th className="px-2.5 py-1.5 font-medium">บัญชี</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">เดบิต</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">เครดิต</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.journal.map((j, i) => (
                      <tr key={i} className={`border-b border-zinc-100 last:border-0 ${j.unclassified ? "bg-red-50/60" : ""}`}>
                        <td className="px-2.5 py-1.5">
                          <span className={`font-medium ${j.unclassified ? "text-red-700" : "text-zinc-700"}`}>{j.accCode}</span>
                          {j.accName && <span className="ml-1 text-zinc-500">{j.accName}</span>}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-zinc-800">{j.debit ? money(j.debit) : ""}</td>
                        <td className="px-2.5 py-1.5 text-right text-zinc-800">{j.credit ? money(j.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : detail ? (
              <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500">
                {detail.journalNote ?? "ไม่มีข้อมูลการลงบัญชี"}
              </p>
            ) : null}
          </section>

          {/* รายการสินค้า */}
          {detail && detail.lines.length > 0 && (
            <section>
              <div className="mb-1.5 text-sm font-medium text-zinc-700">รายการในใบ</div>
              <div className="overflow-hidden rounded-xl border border-zinc-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                      <th className="px-2.5 py-1.5 font-medium">รายการ</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">จำนวน</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((ln, i) => (
                      <tr key={i} className="border-b border-zinc-100 last:border-0">
                        <td className="px-2.5 py-1.5 text-zinc-800">
                          {ln.description || ln.productCode || "—"}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-zinc-500">{ln.quantity ?? "—"}</td>
                        <td className="px-2.5 py-1.5 text-right text-zinc-800">{money(ln.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {detail?.error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-inset ring-amber-200">{detail.error}</p>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-zinc-200 px-4 py-3">
          {doc.pdfUrl ? (
            <a
              href={doc.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline"
            >
              <FileText className="h-4 w-4" /> เปิดใบเต็มใน TRCloud (PDF)
            </a>
          ) : (
            <span className="text-sm text-zinc-400">ไม่มีไฟล์ PDF</span>
          )}
        </div>
      </div>
    </div>
  );
}
