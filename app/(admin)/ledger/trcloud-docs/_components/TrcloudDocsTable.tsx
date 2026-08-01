"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, AlertTriangle, CheckCircle2, XCircle, Send } from "lucide-react";
import type { TrcloudDocRow, TrcloudDocKind } from "@/lib/ledger/trcloud-docs-data";
import { STANDARD_CATEGORIES } from "@/lib/ledger/coa-chart";
import { actSendPoDocsToAp } from "../actions";
import type { SendPoToApResult } from "@/lib/ledger/trcloud-doc-to-ap";
import { DocDetailDrawer } from "./DocDetailDrawer";

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// หมวดมาตรฐาน 21 ตัว (มี c-slot สูตร LL → ลงบัญชีถูกต่อหมวด) — ชุดเดียวที่ "ส่งเข้า AP" ยอมรับ
const CAT_OPTIONS = STANDARD_CATEGORIES.map((c) => ({ gl: c.glCode, name: c.name }));
const CAT_NAME_BY_GL = new Map(STANDARD_CATEGORIES.map((c) => [c.glCode, c.name]));
const IN21 = new Set(STANDARD_CATEGORIES.map((c) => c.glCode));

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

function isConverted(r: TrcloudDocRow): boolean {
  return r.statusAp != null && Number(r.statusAp) > 0;
}
// หมวดเริ่มต้นของแถว: ที่เราตั้งไว้ (ถ้าอยู่ใน 21) > ที่แนะนำ (อยู่ใน 21 เสมอ) > ว่าง
function defaultGl(r: TrcloudDocRow): string {
  if (r.ourAccCode && IN21.has(r.ourAccCode)) return r.ourAccCode;
  if (r.suggestedAccCode && IN21.has(r.suggestedAccCode)) return r.suggestedAccCode;
  return "";
}

export function TrcloudDocsTable({ rows, kind }: { rows: TrcloudDocRow[]; kind: TrcloudDocKind }) {
  const router = useRouter();
  const [selected, setSelected] = useState<TrcloudDocRow | null>(null); // สำหรับ drawer
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [catOverride, setCatOverride] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendPoToApResult[] | null>(null);

  // ใบที่ "ส่งเข้า AP ได้" = แท็บ PO + ยังไม่แปลง (ใบ AP/แปลงแล้วดูอย่างเดียว)
  const eligible = kind === "PO";
  const glForRow = (r: TrcloudDocRow) => catOverride[r.id] ?? defaultGl(r);

  const checkedRows = useMemo(() => rows.filter((r) => checked[r.id] && eligible && !isConverted(r)), [rows, checked, eligible]);
  const checkedCount = checkedRows.length;
  const missingCat = checkedRows.filter((r) => !IN21.has(glForRow(r)));

  const selectableRows = useMemo(() => rows.filter((r) => eligible && !isConverted(r)), [rows, eligible]);
  const allChecked = selectableRows.length > 0 && selectableRows.every((r) => checked[r.id]);

  function toggleAll() {
    if (allChecked) {
      setChecked({});
    } else {
      const next: Record<string, boolean> = {};
      for (const r of selectableRows) next[r.id] = true;
      setChecked(next);
    }
  }

  async function doSend() {
    setSending(true);
    setResults(null);
    const items = checkedRows.map((r) => ({ trcloudId: r.trcloudId, refNo: r.refNo, categoryGl: glForRow(r) }));
    try {
      const res = await actSendPoDocsToAp(items);
      if (!res.ok) {
        setResults([{ trcloudId: "", ok: false, error: res.error ?? "ส่งไม่สำเร็จ" }]);
        return;
      }
      setResults(res.results);
      // ล้างเฉพาะใบที่ส่งสำเร็จ
      const okIds = new Set(
        res.results.filter((x) => x.ok).map((x) => rows.find((r) => r.trcloudId === x.trcloudId)?.id),
      );
      setChecked((prev) => {
        const next = { ...prev };
        for (const id of okIds) if (id) delete next[id];
        return next;
      });
      router.refresh();
    } catch (e) {
      setResults([{ trcloudId: "", ok: false, error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ" }]);
    } finally {
      setSending(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-500">
        ยังไม่มีข้อมูล — กด “รีเฟรชจาก TRCloud” ด้านบนเพื่อดึงเอกสารเข้ามา
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="w-full min-w-[1200px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
              {eligible && (
                <th className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="เลือกทั้งหมด"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="size-4 cursor-pointer accent-[var(--color-brand-600)]"
                  />
                </th>
              )}
              <th className="px-3 py-2 font-medium">ที่มา</th>
              <th className="px-3 py-2 font-medium">วันที่</th>
              <th className="px-3 py-2 font-medium">เลขที่</th>
              <th className="px-3 py-2 font-medium">ผู้ขาย</th>
              <th className="px-3 py-2 font-medium">นิติบุคคล</th>
              <th className="px-3 py-2 font-medium">สาขา</th>
              <th className="px-3 py-2 font-medium">
                หมวดบัญชี{eligible ? <span className="ml-1 font-normal text-zinc-400">(เลือกก่อนส่ง AP)</span> : <span className="ml-1 font-normal text-zinc-400">(ถ้าลง AP)</span>}
              </th>
              <th className="px-3 py-2 font-medium">หมายเหตุ TRCloud</th>
              <th className="px-3 py-2 text-right font-medium">ยอดรวม</th>
              <th className="px-3 py-2 font-medium">สถานะ</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pill = statusPill(kind, r.status, r.statusAp);
              const converted = isConverted(r);
              const rowEligible = eligible && !converted;
              const unclassified = r.ourAccCode === "5919999";
              const gl = glForRow(r);
              const usingSuggestion = rowEligible && !r.ourAccCode && !catOverride[r.id];
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60 ${checked[r.id] ? "bg-[var(--color-brand-50)]/40" : ""}`}
                >
                  {eligible && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {rowEligible ? (
                        <input
                          type="checkbox"
                          aria-label={`เลือกใบ ${r.refNo || r.docNumber || ""}`}
                          checked={!!checked[r.id]}
                          onChange={(e) => setChecked((p) => ({ ...p, [r.id]: e.target.checked }))}
                          className="size-4 cursor-pointer accent-[var(--color-brand-600)]"
                        />
                      ) : null}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.fromLedger ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                        title={r.ledgerDocCode ? `LedgerLine: ${r.ledgerDocCode}` : "ส่งขึ้นจาก LedgerLine"}
                      >
                        ● จากเรา
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200" title="สร้างตรงใน TRCloud (ไม่ได้ผ่าน LedgerLine)">
                        ○ TRCloud
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{r.issueDate ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800">{r.refNo || r.docNumber || "—"}</td>
                  <td className="max-w-[200px] px-3 py-2">
                    <div className="truncate text-zinc-800" title={r.vendorName ?? undefined}>{r.vendorName || "—"}</div>
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-zinc-600" title={r.department ?? undefined}>{r.department || "—"}</td>
                  <td className="max-w-[150px] truncate px-3 py-2 text-zinc-600" title={r.project ?? undefined}>{r.project || "—"}</td>
                  <td className="max-w-[230px] px-3 py-2" onClick={(e) => rowEligible && e.stopPropagation()}>
                    {rowEligible ? (
                      // แก้หมวดได้ก่อนส่ง AP — เริ่มจากที่ระบบแนะนำ
                      <div>
                        <select
                          value={gl}
                          aria-label="เลือกหมวดบัญชี"
                          onChange={(e) => setCatOverride((p) => ({ ...p, [r.id]: e.target.value }))}
                          className={`h-8 w-full rounded-md border bg-white px-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] ${gl ? "border-zinc-200 text-zinc-700" : "border-amber-300 text-amber-700"}`}
                        >
                          <option value="">— เลือกหมวด —</option>
                          {CAT_OPTIONS.map((c) => (
                            <option key={c.gl} value={c.gl}>{c.name} · {c.gl}</option>
                          ))}
                        </select>
                        {usingSuggestion && gl && (
                          <span className="mt-0.5 inline-block text-[10px] text-amber-600">แนะนำอัตโนมัติ · แก้ได้</span>
                        )}
                      </div>
                    ) : r.ourAccCode ? (
                      <span className="inline-flex max-w-full items-center gap-1 truncate text-xs" title={`${r.ourAccCode}${r.ourAccName ? ` ${r.ourAccName}` : ""} (หมวดที่เราตั้งไว้แล้ว)`}>
                        <span className={`font-medium ${unclassified ? "text-red-600" : "text-zinc-700"}`}>{r.ourAccCode}</span>
                        <span className="truncate text-zinc-400">{r.ourCategoryName || r.ourAccName || ""}</span>
                      </span>
                    ) : r.suggestedAccCode ? (
                      <span className="inline-flex max-w-full items-center gap-1 text-xs" title={`แนะนำ: ${r.suggestedAccCode} ${r.suggestedAccName ?? ""}`}>
                        <span className="shrink-0 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">แนะนำ</span>
                        <span className={`font-medium ${r.suggestedConfidence === "low" ? "text-zinc-400" : "text-zinc-600"}`}>{r.suggestedAccCode}</span>
                        <span className="truncate text-zinc-400">{r.suggestedCategoryName}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="max-w-[200px] px-3 py-2">
                    <div className="truncate text-xs text-zinc-500" title={r.invoiceNote ?? undefined}>{r.invoiceNote || <span className="text-zinc-300">—</span>}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="font-medium text-zinc-800">{money(r.grandTotal ?? r.total)}</div>
                    <div className={`text-xs ${r.hasVat ? "text-zinc-400" : "text-zinc-300"}`}>
                      {r.hasVat ? "มี VAT" : "ไม่มี VAT"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pill.cls}`}>{pill.text}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.pdfUrl ? (
                      <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
                        <FileText className="h-3.5 w-3.5" /> PDF
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* แถบลอย: เลือกกี่ใบ + ปุ่มส่งเข้า AP */}
      {checkedCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2.5 shadow-lg">
            <span className="text-sm text-zinc-600">เลือก <b className="text-zinc-900">{checkedCount}</b> ใบ</span>
            <button onClick={() => setChecked({})} className="text-xs text-zinc-400 hover:text-zinc-600">ล้าง</button>
            <button
              onClick={() => { setResults(null); setConfirmOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-600)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              <Send className="h-4 w-4" /> ส่งเข้า AP
            </button>
          </div>
        </div>
      )}

      {/* ป๊อปยืนยัน (money-write) */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button aria-label="ปิด" onClick={() => !sending && setConfirmOpen(false)} className="absolute inset-0 bg-zinc-900/40" />
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="text-base font-semibold text-zinc-900">ยืนยันบันทึกเป็นค่าใช้จ่าย (AP)</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                จะสร้างใบ AP จริงใน TRCloud {checkedCount} ใบ ตามหมวดที่เลือก — ตรวจให้ชัดก่อนกดยืนยัน
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {results ? (
                <ul className="space-y-2">
                  {results.map((res, i) => {
                    const r = rows.find((x) => x.trcloudId === res.trcloudId);
                    return (
                      <li key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${res.ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200"}`}>
                        {res.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                        <span>
                          <b>{r?.refNo || r?.docNumber || res.trcloudId || "—"}</b> — {res.ok ? `สร้าง AP แล้ว${res.apDocNo ? ` (${res.apDocNo})` : ""}` : res.error}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="overflow-hidden rounded-xl border border-zinc-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                        <th className="px-3 py-2 font-medium">ใบ / ผู้ขาย</th>
                        <th className="px-3 py-2 font-medium">นิติบุคคล</th>
                        <th className="px-3 py-2 font-medium">หมวดบัญชี</th>
                        <th className="px-3 py-2 text-right font-medium">ยอดรวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkedRows.map((r) => {
                        const gl = glForRow(r);
                        const noCat = !IN21.has(gl);
                        const noTax = !r.taxId;
                        return (
                          <tr key={r.id} className="border-b border-zinc-100 last:border-0 align-top">
                            <td className="px-3 py-2">
                              <div className="font-medium text-zinc-800">{r.refNo || r.docNumber || "—"}</div>
                              <div className="truncate text-xs text-zinc-500">{r.vendorName || "—"}</div>
                              {noTax && (
                                <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-600">
                                  <AlertTriangle className="h-3 w-3" /> ไม่มีเลขผู้เสียภาษี → ลงเป็นเจ้าหนี้เบ็ดเตล็ด
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-zinc-600">{r.department || <span className="text-rose-500">ไม่มีแผนก</span>}</td>
                            <td className="px-3 py-2">
                              {noCat ? (
                                <span className="text-rose-600">ยังไม่ได้เลือกหมวด</span>
                              ) : (
                                <span className="text-zinc-700">{CAT_NAME_BY_GL.get(gl)} · {gl}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-800">{money(r.grandTotal ?? r.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!results && missingCat.length > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-600">
                  <AlertTriangle className="h-4 w-4" /> มี {missingCat.length} ใบยังไม่ได้เลือกหมวด — เลือกให้ครบก่อนส่ง
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3">
              {results ? (
                <button onClick={() => { setConfirmOpen(false); setResults(null); }} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  ปิด
                </button>
              ) : (
                <>
                  <button onClick={() => setConfirmOpen(false)} disabled={sending} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">
                    ยกเลิก
                  </button>
                  <button
                    onClick={doSend}
                    disabled={sending || missingCat.length > 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {sending ? "กำลังส่ง…" : `ยืนยันส่ง ${checkedCount} ใบ`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <DocDetailDrawer doc={selected} onClose={() => setSelected(null)} />
    </>
  );
}
