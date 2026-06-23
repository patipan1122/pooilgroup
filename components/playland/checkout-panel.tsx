"use client";

// จังหวะ 3 "เช็คเอาท์" · แผงสรุปยอดเด็ก 1 คน + ปุ่มปิดรอบ + จอขอบคุณ
// reuse checkOutSession เดิม · ยอดนี้ชำระแล้วตอนเช็คอิน เช็คเอาท์ = ปิดรอบ (ไม่เก็บเงินซ้ำ)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkOutSession } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { LogOut, Clock, CheckCircle2 } from "lucide-react";

export function CheckoutPanel({
  sessionId,
  name,
  typeLabel,
  packageName,
  packagePriceCents,
  checkInLabel,
  usedLabel,
}: {
  sessionId: string;
  name: string;
  typeLabel: string;
  packageName: string;
  packagePriceCents: number;
  checkInLabel: string;
  usedLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  function doCheckout() {
    start(async () => {
      const res = await checkOutSession(sessionId);
      if (!res.ok) { alert(res.error); return; }
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="pl-checkout-done">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/playland/brand/mascot-rocky.png" alt="" width={120} height={120} style={{ objectFit: "contain" }} />
        <div className="pl-checkout-done-title"><CheckCircle2 size={22} /> เช็คเอาท์เรียบร้อย</div>
        <div className="pl-checkout-done-sub">ขอบคุณค่ะ · แล้วเจอกันใหม่ 💛</div>
      </div>
    );
  }

  return (
    <div className="pl-bill">
      <div className="pl-bill-head">
        <div className="pl-bill-name">{name}</div>
        <div className="pl-bill-sub">{typeLabel}</div>
      </div>
      <div className="pl-bill-rows">
        <div className="pl-bill-row"><span>แพ็กเกจ</span><span>{packageName}</span></div>
        <div className="pl-bill-row"><span><Clock size={13} /> เข้าเล่น</span><span>{checkInLabel} · ใช้ไป {usedLabel}</span></div>
      </div>
      <div className="pl-bill-total">
        <span>ยอดรวม (ชำระแล้วตอนเช็คอิน)</span>
        <span className="pl-bill-amount">{thb(packagePriceCents)}</span>
      </div>
      <button className="pl-btn pl-btn-danger pl-btn-lg" style={{ width: "100%", marginTop: 14 }} onClick={doCheckout} disabled={pending}>
        <LogOut size={18} /> {pending ? "กำลังปิดรอบ…" : "เช็คเอาท์ · ปิดรอบ"}
      </button>
      <div style={{ fontSize: "0.72rem", color: "var(--pl-text-muted)", textAlign: "center", marginTop: 8 }}>
        ปิดรอบถาวร · ไม่เก็บเงินซ้ำ · ไม่คืนเงิน
      </div>
    </div>
  );
}
