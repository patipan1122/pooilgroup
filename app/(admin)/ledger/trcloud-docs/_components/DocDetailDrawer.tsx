"use client";
import { useEffect, useState } from "react";
import { X, FileText, AlertTriangle, Loader2, CheckCircle2, Info } from "lucide-react";
import { actReadTrcloudDocDetail } from "../actions";
import { SKU_LABELS, STANDARD_CATEGORIES } from "@/lib/ledger/coa-chart";
import type { TrcloudDocDetail } from "@/lib/ledger/trcloud-doc-detail";
import type { TrcloudDocRow } from "@/lib/ledger/trcloud-docs-data";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// SKU (product_id) → ชื่อประเภท ถ้าเป็น SKU มาตรฐานของเรา (JPS-100/101/103). ตัวอื่นคืน null.
function skuLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return (SKU_LABELS as Record<string, string>)[code] ?? null;
}

const CAT_BY_GL = new Map(STANDARD_CATEGORIES.map((c) => [c.glCode, c]));

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
  const beforeVat = h?.total ?? (doc.total != null && doc.tax != null ? doc.total - doc.tax : null);
  const grand = h?.grandTotal ?? doc.grandTotal ?? doc.total;

  // หมวดที่จะใช้ (ที่เราตั้ง > ที่แนะนำ) — สำหรับ "ตรวจการลงบัญชี"
  const usedGl = doc.ourAccCode ?? doc.suggestedAccCode;
  const usedName = doc.ourCategoryName ?? doc.suggestedCategoryName;
  const usedCat = usedGl ? CAT_BY_GL.get(usedGl) : undefined;
  const converted = doc.kind === "PO" && doc.statusAp != null && Number(doc.statusAp) > 0;

  // ── ตรวจความเหมาะสมของการลงบัญชี (ธงเตือนภาษาคน) ──
  const checks: { level: "ok" | "warn" | "info"; text: string }[] = [];
  if (detail?.hasUnclassified) {
    checks.push({ level: "warn", text: "ลงบัญชีเป็น 5919999 (ยังไม่ได้แยกประเภท) — ควรแก้หมวดให้ถูกต้อง" });
  }
  if (usedCat) {
    if (usedCat.vatClaimable && !doc.hasVat) {
      checks.push({ level: "warn", text: `หมวด "${usedCat.name}" ปกติมีภาษีซื้อขอคืนได้ แต่ใบนี้ไม่มี VAT — ตรวจว่าหมวดถูกไหม` });
    }
    if (!usedCat.vatClaimable && doc.hasVat) {
      checks.push({ level: "warn", text: `ใบนี้มี VAT แต่หมวด "${usedCat.name}" ขอคืนภาษีซื้อไม่ได้ (จะไม่เข้า ภ.พ.30)` });
    }
    if (usedCat.wht) {
      checks.push({ level: "info", text: `หมวดนี้ปกติมีภาษีหัก ณ ที่จ่าย ${usedCat.wht}% — บันทึกตอนจ่ายเงิน` });
    }
    if (usedCat.note) checks.push({ level: "info", text: usedCat.note });
  }
  if (doc.kind === "PO" && !doc.ourAccCode && doc.suggestedConfidence === "low") {
    checks.push({ level: "warn", text: "ระบบเดาหมวดไม่ชัด — ควรเลือกหมวดเองก่อนส่งเข้า AP" });
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* backdrop */}
      <button aria-label="ปิด" onClick={onClose} className="absolute inset-0 bg-zinc-900/30" />
      {/* panel */}
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        {/* header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-3">
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
            <p className="truncate text-xs text-zinc-500">
              {doc.vendorName || "—"} · {doc.issueDate ?? "—"}
              {doc.department ? ` · ${doc.department}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* body (scroll) */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ยอดเงิน */}
          <section className="rounded-xl border border-zinc-200 p-3">
            <div className="grid grid-cols-2 gap-y-1.5 text-sm">
              <span className="text-zinc-500">ก่อน VAT</span>
              <span className="text-right text-zinc-800">{money(beforeVat)}</span>
              <span className="text-zinc-500">VAT</span>
              <span className="text-right text-zinc-800">
                {doc.hasVat ? money(h?.tax ?? doc.tax) : <span className="text-zinc-400">ไม่มี VAT</span>}
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

          {/* หมวด + ตรวจการลงบัญชี */}
          <section className="rounded-xl border border-zinc-200 p-3">
            <div className="mb-2 text-sm font-medium text-zinc-700">
              {doc.kind === "PO" && !converted ? "ถ้าบันทึกเป็นค่าใช้จ่าย (AP) จะลงหมวด" : "หมวด/การลงบัญชี"}
            </div>
            {usedGl ? (
              <div className="flex items-center gap-2 text-sm">
                {!doc.ourAccCode && (
                  <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">แนะนำ</span>
                )}
                <span className="font-medium text-zinc-800">{usedName || "—"}</span>
                <span className="text-zinc-400">· {usedGl}</span>
              </div>
            ) : (
              <div className="text-sm text-zinc-400">— ยังไม่มีหมวด —</div>
            )}

            {/* ธงตรวจความเหมาะสม */}
            {checks.length > 0 && (
              <ul className="mt-2 space-y-1">
                {checks.map((c, i) => (
                  <li key={i} className={`flex items-start gap-1.5 text-xs ${c.level === "warn" ? "text-amber-700" : c.level === "ok" ? "text-emerald-700" : "text-zinc-500"}`}>
                    {c.level === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : c.level === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* การลงบัญชีจริง (Dr/Cr) — AP เท่านั้น */}
          <section>
            <div className="mb-1.5 text-sm font-medium text-zinc-700">การลงบัญชีจริงใน TRCloud</div>
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-4 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังอ่านจาก TRCloud…
              </div>
            ) : detail && detail.journal.length > 0 ? (
              <>
                {detail.hasUnclassified && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>ลงบัญชีเป็น <b>5919999 รายจ่ายยังไม่ได้แยกประเภท</b> — ควรแก้หมวดให้ถูกต้อง</span>
                  </div>
                )}
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
              </>
            ) : detail ? (
              <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500">
                {detail.journalNote ?? "ไม่มีข้อมูลการลงบัญชี"}
              </p>
            ) : null}
          </section>

          {/* รายการสินค้า — กางเป็นตารางเต็ม (ชื่อ · จำนวน · ราคา/หน่วย · ก่อน VAT · VAT · รวม) */}
          <section>
            <div className="mb-1.5 text-sm font-medium text-zinc-700">รายการในใบ {detail && detail.lines.length > 0 ? <span className="font-normal text-zinc-400">({detail.lines.length} รายการ)</span> : null}</div>
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-4 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังอ่านรายการ…
              </div>
            ) : detail && detail.lines.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                      <th className="px-2.5 py-1.5 font-medium">สินค้า</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">จำนวน</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">ราคา/หน่วย</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">ก่อน VAT</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">VAT</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((ln, i) => (
                      <tr key={i} className="border-b border-zinc-100 last:border-0 align-top">
                        <td className="px-2.5 py-2">
                          <div className="text-zinc-800">{ln.description || ln.productCode || "—"}</div>
                          {ln.productCode && (
                            <div className="text-[11px] text-zinc-400">
                              <span className="font-mono">{ln.productCode}</span>
                              {skuLabel(ln.productCode) && <span> · {skuLabel(ln.productCode)}</span>}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right text-zinc-600">{ln.quantity ?? "—"}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right text-zinc-600">{money(ln.price)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right text-zinc-600">{money(ln.beforeVat)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right text-zinc-600">{money(ln.vat)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium text-zinc-800">{money(ln.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : detail ? (
              <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-400">ไม่มีรายการสินค้าในใบนี้</p>
            ) : null}
          </section>

          {detail?.error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-inset ring-amber-200">{detail.error}</p>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-zinc-200 px-5 py-3">
          {doc.pdfUrl ? (
            <a href={doc.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
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
