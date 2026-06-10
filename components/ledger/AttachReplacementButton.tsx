"use client";

// AttachReplacementButton — แนบ "ใบกำกับเต็มรูปทดแทน" ใบเหลือง/แดง เพื่อกู้ภาษีซื้อ.
//
// flow (ต่อ backend จริง — ไม่มีปุ่มตาย):
//   1. เลือก/ถ่ายรูปใบใหม่ → อ่านเป็น base64 data-url ฝั่ง client
//   2. เรียก attachReplacementInvoice({ expenseId, imageBase64 }) (action จริง):
//      upload R2 → parseReceipt → สร้างใบใหม่ status=draft (ห้าม auto-post) ผูก 2 ใบ
//      → re-grade → flip สีถ้าผ่าน + audit
//   3. สำเร็จ → refresh ให้แพเนลโชว์สถานะใหม่ + รูปใบทดแทน
//
// action ฉีดผ่าน prop (เหมือน onSave/onConfirm) → ใช้ได้ทั้ง web และ LIFF.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

const MAX_BYTES = 8 * 1024 * 1024;

export type AttachReplacementResult = {
  ok: boolean;
  error?: string;
  replacementId?: string;
  completenessStatus?: string;
};

export type AttachReplacementAction = (raw: {
  expenseId: string;
  imageBase64: string;
}) => Promise<AttachReplacementResult>;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

export function AttachReplacementButton({
  expenseId,
  onAttach,
  disabled = false,
}: {
  expenseId: string;
  /** the real server action (attachReplacementInvoice), injected by the pane wrapper. */
  onAttach: AttachReplacementAction;
  disabled?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function pick() {
    setErr(null);
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("กรุณาเลือกไฟล์รูปภาพ (jpg/png/webp/heic)");
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr("รูปใหญ่เกิน 8 MB");
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const imageBase64 = await fileToDataUrl(file);
      const res = await onAttach({ expenseId, imageBase64 });
      if (res.ok) {
        setDone(true);
        startTransition(() => router.refresh());
        setTimeout(() => setDone(false), 2000);
      } else {
        setErr(res.error ?? "แนบใบทดแทนไม่สำเร็จ");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "แนบใบทดแทนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onFile}
        aria-hidden
        tabIndex={-1}
      />
      <button
        type="button"
        onClick={pick}
        disabled={busy || disabled}
        className="press inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : done ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <FilePlus2 className="size-4" aria-hidden />
        )}
        {busy ? "กำลังอ่านใบใหม่…" : done ? "แนบแล้ว · กำลังอัปเดต" : "แนบใบใหม่ทดแทน"}
      </button>
      {err && (
        <p className="flex items-center gap-1 text-xs text-red-700" role="alert">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {err}
        </p>
      )}
      <p className="text-[11px] text-zinc-500">
        ถ่าย/อัปโหลดใบกำกับเต็มรูปที่ขอใหม่จากร้าน ระบบจะเก็บทั้ง 2 ใบ แล้วอัปเดตสถานะให้
      </p>
    </div>
  );
}
