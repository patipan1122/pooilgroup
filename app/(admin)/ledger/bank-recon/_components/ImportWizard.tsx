"use client";

// ImportWizard — 3-step drag-drop import wizard.
// Step 1: Upload file → dry-run preview
// Step 2: Review detected format + row counts + balance check
// Step 3: Confirm → commit to DB
//
// Desktop-only (D17: mobile has file picker issues with SheetJS memory).

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, CheckCircle, AlertTriangle, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dryRunImportAction, commitImportAction } from "../_actions";
import type { ImportDryRunResult } from "../_actions";

const BANK_LABELS: Record<string, string> = {
  KBANK: "กสิกรไทย (KBank)",
  SCB:   "ไทยพาณิชย์ (SCB)",
  TTB:   "TTB",
  BBL:   "กรุงเทพ (BBL)",
  BAAC:  "ธ.ก.ส.",
};

interface Props {
  bankAccountId: string;
  accountName: string;
  onSuccess: (batchId: string) => void;
}

export function ImportWizard({ bankAccountId, accountName, onSuccess }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportDryRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = async (f: File) => {
    setFile(f);
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const result = await dryRunImportAction(fd);
      setPreview(result);
      setStep(2);
    } catch (e) {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  // Generate + download the universal LedgerLine Excel template (any bank, no parser needed).
  // xlsx is imported lazily on click so it never bloats the page bundle.
  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const aoa = [
      ["วันที่", "เงินเข้า", "เงินออก", "รายละเอียด", "คู่ค้า/อ้างอิง"],
      ["01/06/2026", 50000, "", "รับโอนค่าสินค้า", "บจก. ตัวอย่าง"],
      ["02/06/2026", "", 1250.5, "ค่าไฟฟ้า", "การไฟฟ้านครหลวง"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "statement");
    XLSX.writeFile(wb, "LedgerLine-template.xlsx");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleCommit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await commitImportAction(bankAccountId, fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep(3);
      setTimeout(() => onSuccess(result.batchId), 1200);
    } catch (e) {
      setError("นำเข้าไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  if (step === 3) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <CheckCircle className="text-emerald-500" size={48} />
        <p className="text-lg font-semibold text-zinc-800">นำเข้าสำเร็จ!</p>
        <p className="text-sm text-zinc-500">กำลังไปหน้ากระทบยอด...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-zinc-800">
        นำเข้า bank statement — {accountName}
      </h2>

      {/* Step 1: Upload */}
      {step === 1 && (
        <>
        <div
          className={`relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 transition-colors ${
            isDragging
              ? "border-blue-400 bg-blue-50"
              : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
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
              <p className="text-sm text-zinc-500">กำลังวิเคราะห์ไฟล์...</p>
            </div>
          ) : (
            <>
              <Upload size={32} className="text-zinc-400" />
              <p className="text-sm font-medium text-zinc-700">
                ลากวางไฟล์ หรือคลิกเพื่อเลือก
              </p>
              <p className="text-xs text-zinc-400">
                รองรับ CSV / Excel จาก KBank KBIZ · SCB · TTB · BBL
              </p>
              <p className="text-xs text-zinc-400">
                หรือไฟล์ตัวอย่าง Excel ของ LedgerLine — ใช้ได้กับ <strong>ทุกธนาคาร</strong>
              </p>
            </>
          )}
        </div>

        {/* Universal template — works for any bank, no dedicated parser needed */}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-zinc-700">ธนาคารไม่อยู่ในรายการ?</p>
            <p className="text-xs text-zinc-400">
              ดาวน์โหลดไฟล์ตัวอย่าง กรอกวันที่/เงินเข้า/เงินออก แล้วอัปกลับมาได้เลย
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={downloadTemplate}
            className="flex shrink-0 items-center gap-1.5"
          >
            <Download size={14} />
            ไฟล์ตัวอย่าง Excel
          </Button>
        </div>
        </>
      )}

      {/* Step 2: Preview */}
      {step === 2 && preview && (
        <div className="space-y-3">
          {!preview.ok ? (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={14} />
              {preview.error}
            </div>
          ) : (
            <>
              {/* File detected */}
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <FileText size={16} className="text-emerald-600" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-emerald-800">
                    ตรวจพบ: {preview.formatVersion.startsWith("TEMPLATE")
                      ? "ไฟล์ตัวอย่าง LedgerLine"
                      : (BANK_LABELS[preview.bankCode] ?? preview.bankCode)}
                  </p>
                  <p className="text-xs text-emerald-600">{file?.name}</p>
                </div>
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "รายการทั้งหมด",  value: preview.rowCount },
                  { label: "รับเงิน (Credit)", value: preview.creditCount },
                  { label: "จ่ายเงิน (Debit)", value: preview.debitCount },
                  { label: "ช่วงวันที่",      value: `${preview.periodStart} → ${preview.periodEnd}` },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-zinc-100 bg-white p-3">
                    <p className="text-xs text-zinc-400">{item.label}</p>
                    <p className="text-sm font-semibold text-zinc-800">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Amounts */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-xs text-emerald-600">ยอดรับเข้าทั้งหมด</p>
                  <p className="text-lg font-bold text-emerald-700">
                    ฿{(preview.totalCreditSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="rounded-xl border border-red-100 bg-red-50 p-3">
                  <p className="text-xs text-red-600">ยอดจ่ายออกทั้งหมด</p>
                  <p className="text-lg font-bold text-red-700">
                    ฿{(preview.totalDebitSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-700">คำเตือน ({preview.warnings.length})</p>
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-600">• {w}</p>
                  ))}
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setStep(1); setPreview(null); setFile(null); }}>
              เลือกไฟล์ใหม่
            </Button>
            {preview.ok && (
              <Button onClick={handleCommit} disabled={loading} className="flex items-center gap-1">
                {loading ? "กำลังนำเข้า..." : "ยืนยันนำเข้า"}
                <ChevronRight size={14} />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
