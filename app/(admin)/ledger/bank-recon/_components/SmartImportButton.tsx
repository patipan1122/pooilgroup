"use client";

// SmartImportButton — "นำเข้า statement" จากหน้ารวมบัญชี โดยไม่ต้องเลือกบัญชีก่อน.
// ลากไฟล์วาง → ระบบอ่าน "ธนาคาร + เลขบัญชี" จากตัวไฟล์ → จับคู่บัญชีจริงในระบบให้เอง
// → โชว์บัญชีที่ตรวจพบให้ยืนยัน → นำเข้า → ไปหน้ากระทบยอดของบัญชีนั้น.
//
// ตัวไฟล์กสิกร/SCB/TTB มีเลขบัญชีในหัวกระดาษ → เดาบัญชีได้แม่น.
// กรุงเทพ + ไฟล์ตัวอย่าง Excel ไม่มีเลขบัญชี → รู้แค่ธนาคาร → ให้ผู้ใช้แตะเลือก.

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, AlertTriangle, CheckCircle, ChevronRight, Landmark, Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { smartImportDetectAction, commitImportAction, type SmartDetectResult } from "../_actions";

interface Props {
  companyId: string;
  period: string; // fallback period for redirect (YYYY-MM)
}

const baht = (s: number) =>
  (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodOf = (iso: string) => iso.slice(0, 7); // "2026-06-14" → "2026-06"

export function SmartImportButton({ companyId, period }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [detect, setDetect] = useState<SmartDetectResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function reset() {
    setFile(null); setDetect(null); setSelectedId(null);
    setError(null); setLoading(false); setCommitting(false); setDone(false); setIsDragging(false);
  }
  function close() { setOpen(false); setTimeout(reset, 200); }

  async function handleFile(f: File) {
    setFile(f); setError(null); setDetect(null); setSelectedId(null); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await smartImportDetectAction(companyId, fd);
      setDetect(res);
      if (res.ok) setSelectedId(res.autoSelectedId);
    } catch {
      setError("อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!file || !selectedId) return;
    setCommitting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await commitImportAction(selectedId, fd);
      if (!res.ok) { setError(res.error); return; }
      setDone(true);
      const dest = detect && detect.ok ? periodOf(detect.periodEnd) : period;
      setTimeout(() => {
        router.push(`/ledger/bank-recon/${selectedId}/reconcile?company=${companyId}&period=${dest}`);
      }, 1000);
    } catch {
      setError("นำเข้าไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Upload size={14} />
        นำเข้า statement
      </button>

      <Dialog open={open} onClose={close} title="นำเข้า statement" className="sm:max-w-lg">
        {/* Success */}
        {done ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle className="text-emerald-500" size={44} />
            <p className="text-lg font-semibold text-zinc-800">นำเข้าสำเร็จ!</p>
            <p className="text-sm text-zinc-500">กำลังไปหน้ากระทบยอด...</p>
          </div>
        ) : !detect ? (
          /* Step 1 — drop file */
          <div className="space-y-3">
            <div
              className={`relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 transition-colors ${
                isDragging ? "border-blue-400 bg-blue-50" : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.CSV,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  <p className="text-sm text-zinc-500">กำลังอ่านไฟล์ + หาบัญชี...</p>
                </div>
              ) : (
                <>
                  <Upload size={30} className="text-zinc-400" />
                  <p className="text-sm font-medium text-zinc-700">ลากวางไฟล์ statement หรือคลิกเพื่อเลือก</p>
                  <p className="text-center text-xs text-zinc-400">
                    ระบบจะอ่านเองว่าเป็น<strong>ธนาคารไหน บัญชีไหน</strong><br />
                    รองรับ KBank · SCB · TTB · กรุงเทพ · ไฟล์ตัวอย่าง Excel
                  </p>
                </>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        ) : !detect.ok ? (
          /* Detection failed */
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{detect.error}</span>
            </div>
            <Button variant="outline" onClick={reset}>เลือกไฟล์ใหม่</Button>
          </div>
        ) : (
          /* Step 2 — detection result + account picker + preview */
          <div className="space-y-4">
            {/* What we detected */}
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <FileText size={16} className="shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-800">
                  ตรวจพบ: {detect.bankLabel}
                  {detect.fileLast4 && <span className="font-mono"> · บัญชี ****{detect.fileLast4}</span>}
                </p>
                <p className="truncate text-xs text-emerald-600">{file?.name}</p>
              </div>
            </div>

            {/* Account selection */}
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-500">นำเข้าไปยังบัญชี</p>

              {detect.candidates.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  {detect.unknownAccount
                    ? <>ไฟล์นี้เป็นบัญชี <strong>{detect.bankLabel}{detect.fileLast4 ? ` ****${detect.fileLast4}` : ""}</strong> ซึ่งยังไม่มีในระบบ</>
                    : <>ยังไม่มีบัญชีที่นำเข้าได้สำหรับธนาคารนี้</>}
                  <Link
                    href={`/ledger/bank-recon/accounts?company=${companyId}`}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    <Landmark size={12} /> ไปเพิ่มบัญชีธนาคาร
                  </Link>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {detect.unknownAccount && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      เลขบัญชีในไฟล์ (****{detect.fileLast4}) ไม่ตรงกับบัญชีที่มี — เลือกบัญชีที่ถูกต้องด้านล่าง
                    </p>
                  )}
                  {detect.candidates.map((c) => {
                    const active = selectedId === c.accountId;
                    return (
                      <button
                        key={c.accountId}
                        type="button"
                        onClick={() => setSelectedId(c.accountId)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-zinc-200 bg-white hover:bg-zinc-50"
                        }`}
                      >
                        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-blue-600 bg-blue-600" : "border-zinc-300"}`}>
                          {active && <Check size={13} className="text-white" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-800">{c.accountName}</span>
                          <span className="font-mono text-xs text-zinc-400">{c.accountNoMasked}</span>
                        </span>
                        {c.exact && (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            เลขตรง
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Preview summary */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-zinc-400">รายการ</p><p className="font-semibold text-zinc-800">{detect.rowCount}</p></div>
              <div><p className="text-xs text-zinc-400">ช่วงวันที่</p><p className="text-xs font-semibold text-zinc-800">{detect.periodStart} → {detect.periodEnd}</p></div>
              <div><p className="text-xs text-emerald-600">รับเข้า</p><p className="font-semibold text-emerald-700">฿{baht(detect.totalCreditSatang)}</p></div>
              <div><p className="text-xs text-rose-600">จ่ายออก</p><p className="font-semibold text-rose-700">฿{baht(detect.totalDebitSatang)}</p></div>
            </div>

            {detect.warnings.length > 0 && (
              <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700">คำเตือน</p>
                {detect.warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>เลือกไฟล์ใหม่</Button>
              <Button onClick={handleCommit} disabled={!selectedId || committing} className="flex flex-1 items-center justify-center gap-1">
                {committing ? "กำลังนำเข้า..." : "ยืนยันนำเข้า"}
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
