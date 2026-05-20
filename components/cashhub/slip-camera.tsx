"use client";

// SlipCamera — staff ถ่ายสลิปโอน → Gemini Vision OCR → auto-fill ยอดโอน
// CEO 2026-05-20: ใช้ Gemini Flash 2.5 เพราะถูกสุด · ~$0.0001/สลิป

import { useRef, useState } from "react";
import { Camera, Loader2, CheckCircle2, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  onAmountDetected: (amount: number) => void;
  onSlipUploaded: (url: string) => void;
  currentSlipUrl: string | null;
}

interface OcrResponse {
  amount: number | null;
  bank: string | null;
  refNo: string | null;
  datetime: string | null;
  slipUrl: string;
  error?: string;
}

export function SlipCamera({
  onAmountDetected,
  onSlipUploaded,
  currentSlipUrl,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    amount: number | null;
    bank: string | null;
    refNo: string | null;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cashhub/ocr-slip", {
        method: "POST",
        body: fd,
      });
      const json: OcrResponse = await res.json();
      if (!res.ok) {
        toast.error(
          ((json as unknown) as { error?: string }).error ||
            "อ่านสลิปไม่สำเร็จ",
        );
        return;
      }
      setResult({
        amount: json.amount,
        bank: json.bank,
        refNo: json.refNo,
      });
      if (json.slipUrl) onSlipUploaded(json.slipUrl);
      if (json.amount && json.amount > 0) {
        onAmountDetected(json.amount);
        toast.success(
          `✅ พบยอด ฿${json.amount.toLocaleString("th-TH")} ${
            json.bank ? `(${json.bank})` : ""
          }`,
        );
      } else {
        toast.warning(json.error || "อ่านยอดไม่ออก · กรอกเอง · รูปบันทึกแล้ว");
      }
    } catch (err) {
      console.error("[slip-camera]", err);
      toast.error("ส่งสลิปไม่ได้ ลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  function clearSlip() {
    setResult(null);
    onSlipUploaded("");
  }

  if (currentSlipUrl) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSlipUrl}
            alt="สลิป"
            className="size-16 rounded-lg object-cover border border-zinc-200 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="size-4" />
              แนบสลิปแล้ว
            </div>
            {result?.amount && (
              <div className="text-xs text-zinc-600 mt-1 tabular-num">
                AI อ่าน: ฿{result.amount.toLocaleString("th-TH")}{" "}
                {result.bank && (
                  <span className="text-zinc-500">· {result.bank}</span>
                )}
                {result.refNo && (
                  <span className="text-zinc-400 block text-[10px] truncate">
                    Ref: {result.refNo}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clearSlip}
            className="size-7 rounded-full bg-white hover:bg-red-50 border border-zinc-200 text-zinc-600 hover:text-red-700 inline-flex items-center justify-center shrink-0"
            aria-label="ลบสลิป"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        className="w-full h-12 rounded-xl bg-white border-2 border-dashed border-zinc-300 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/30 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm font-semibold text-zinc-700 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="size-5 animate-spin text-[var(--color-brand-600)]" />
            กำลังอ่านสลิป...
          </>
        ) : (
          <>
            <Camera className="size-5 text-[var(--color-brand-600)]" />
            📷 ถ่ายสลิป · AI ช่วยกรอกยอดโอน
          </>
        )}
      </button>
      <p className="text-[11px] text-zinc-500 mt-2 text-center leading-tight flex items-center justify-center gap-1">
        <AlertCircle className="size-3" />
        รองรับ K-Plus · SCB Easy · KMA · TTB · BBL · GSB · ฯลฯ
      </p>
    </div>
  );
}
