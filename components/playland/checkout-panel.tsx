"use client";

// จังหวะ 3 "เช็คเอาท์" — คอลัมน์เดียว ใบเสร็จ (ตามต้นแบบ §4)
// kid row + ใบเสร็จ + ยอดรวม + วิธีชำระ + ปุ่มเขียว → จอขอบคุณ
// reuse checkOutSession เดิม · หมายเหตุ: ระบบเก็บเงินตอนเช็คอิน → ปุ่มนี้ = ปิดรอบ

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkOutSession } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { CheckCircle2, Check } from "lucide-react";

const METHODS = [
  { id: "CASH", label: "เงินสด" },
  { id: "QR", label: "PromptPay" },
  { id: "CARD", label: "บัตร" },
] as const;

function fmtRemain(expiresAt: string | null, unlimited: boolean): string {
  if (unlimited) return "ทั้งวัน";
  if (!expiresAt) return "—";
  const sec = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (sec <= 0) return "หมดเวลา";
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CheckoutPanel({
  sessionId,
  name,
  mascot,
  packageName,
  packagePriceCents,
  packageMinutes,
  expiresAt,
}: {
  sessionId: string;
  name: string;
  mascot: string;
  packageName: string;
  packagePriceCents: number;
  packageMinutes: number;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [method, setMethod] = useState<string>("CASH");
  const [done, setDone] = useState(false);
  const unlimited = packageMinutes === 0;
  const [remain, setRemain] = useState(() => fmtRemain(expiresAt, unlimited));

  useEffect(() => {
    if (unlimited) return;
    const id = setInterval(() => setRemain(fmtRemain(expiresAt, unlimited)), 1000);
    return () => clearInterval(id);
  }, [expiresAt, unlimited]);

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
        <img src={`/playland/brand/mascot-${mascot}.png`} alt="" width={130} height={130} style={{ objectFit: "contain" }} />
        <div className="pl-co-done-check"><CheckCircle2 size={28} /></div>
        <div className="pl-checkout-done-title">เช็คเอาท์เรียบร้อย</div>
        <div className="pl-checkout-done-sub">{name} · ขอบคุณค่ะ 💛</div>
        <a href="/playland" className="pl-btn pl-btn-primary pl-btn-lg" style={{ marginTop: 14 }}>กลับหน้าหลัก</a>
      </div>
    );
  }

  return (
    <div className="pl-co">
      <div className="pl-co-kid">
        <div className="pl-co-ava">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/playland/brand/mascot-${mascot}.png`} alt="" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pl-co-name">{name} · เช็คเอาท์</div>
          <div className="pl-co-sub">{packageName}</div>
        </div>
        <span className="pl-co-remain">เหลือ {remain}</span>
      </div>

      <div className="pl-co-charge">
        <div className="pl-co-line">
          <span>ค่าเล่น · {packageName}</span>
          <span>{thb(packagePriceCents)}</span>
        </div>
      </div>

      <div className="pl-co-total">
        <span>รวมทั้งหมด <span style={{ fontSize: "0.78rem" }}>(ชำระแล้วตอนเช็คอิน)</span></span>
        <span className="pl-co-total-amt">{thb(packagePriceCents)}</span>
      </div>

      <div className="pl-co-foot">
        <div className="pl-co-pay-label">ชำระด้วย</div>
        <div className="pl-co-methods">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`pl-co-method${method === m.id ? " is-sel" : ""}`}
              onClick={() => setMethod(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" className="pl-co-confirm" onClick={doCheckout} disabled={pending}>
          <Check size={20} /> {pending ? "กำลังปิดรอบ…" : `เช็คเอาท์ · ปิดรอบ ${thb(packagePriceCents)}`}
        </button>
      </div>
    </div>
  );
}
