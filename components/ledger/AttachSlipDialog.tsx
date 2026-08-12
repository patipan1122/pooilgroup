"use client";

// AttachSlipDialog — popup แนบสลิปตรงจากหน้ารายจ่าย (ไม่ต้องออกไปหน้า /ledger/pay/[id]).
// ห่อ AttachSlipForm เดิม (อัป R2 → OCR → จับคู่คำขอ → ปิดบิล + ออก PV อัตโนมัติ) ไว้ใน dialog
// shell แบบเดียวกับ PriceLookupDialog/payee dialog เดิมในหน้านี้ — ไม่มีตรรกะใหม่ ไม่มี state ซ้ำ.
import { useEffect } from "react";
import { X } from "lucide-react";
import { AttachSlipForm } from "@/app/(admin)/ledger/pay/[requestId]/AttachSlipForm";

export function AttachSlipDialog({
  requestId,
  onClose,
}: {
  requestId: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!requestId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestId, onClose]);

  if (!requestId) return null;

  return (
    <div
      onClick={onClose}
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="แนบสลิปโอนเงิน"
        className="animate-slide-up-soft relative w-full max-w-md pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        {/* AttachSlipForm มีการ์ด+หัวข้อของตัวเองอยู่แล้ว — X ลอยมุมขวาบนพอ ไม่ซ้อนหัวข้อ 2 ชั้น */}
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="press absolute -top-2 right-2 z-10 grid size-9 place-items-center rounded-full bg-white text-zinc-500 shadow-md hover:bg-zinc-100"
        >
          <X className="size-4" />
        </button>
        <AttachSlipForm requestId={requestId} />
      </div>
    </div>
  );
}
