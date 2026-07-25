"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { actConfirmTenantPayment, actRejectTenantPayment } from "../../_actions";

export function SlipReviewButtons({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function doConfirm() {
    if (!window.confirm("ยืนยันว่าได้รับเงินตามสลิปนี้จริง? ยอดจะถูกบันทึกเข้าบิล")) return;
    setBusy(true);
    setErr("");
    try {
      await actConfirmTenantPayment(paymentId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function doReject() {
    const note = window.prompt("เหตุผลที่ปฏิเสธ (ไม่บังคับ)") ?? undefined;
    setBusy(true);
    setErr("");
    try {
      await actRejectTenantPayment(paymentId, note || undefined);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex gap-1.5">
        <button onClick={doConfirm} disabled={busy} className="rs-btn text-[12.5px] inline-flex items-center gap-1 disabled:opacity-60" style={{ background: "var(--rs-ok)", color: "#fff" }}>
          <Check className="h-3.5 w-3.5" /> ยืนยัน
        </button>
        <button onClick={doReject} disabled={busy} className="rs-btn-ghost text-[12.5px] inline-flex items-center gap-1 disabled:opacity-60" style={{ color: "var(--rs-danger)" }}>
          <X className="h-3.5 w-3.5" /> ปฏิเสธ
        </button>
      </div>
      {err && <span className="text-[11px]" style={{ color: "var(--rs-danger)" }}>{err}</span>}
    </div>
  );
}
