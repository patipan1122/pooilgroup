"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, X } from "lucide-react";
import { actRecordCombinedPayment } from "../../_actions";

function num(v: string): number {
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * #10 — รับชำระรวมทุกห้องของผู้เช่ารายเดียว.
 * จัดสรรอัตโนมัติเข้าบิลค้างจากเก่าไปใหม่ (แก้ปัญหา "ลูกค้าจ่ายรวมก้อนเดียวแล้วงง").
 */
export default function CombinedPaymentButton({
  tenantId,
  outstanding,
}: {
  tenantId: string;
  outstanding: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(String(Math.round(outstanding * 100) / 100));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<"cash" | "transfer" | "qr" | "card">("transfer");
  const [reference, setReference] = useState("");

  function submit() {
    if (num(amount) <= 0) {
      toast.error("กรุณาระบุยอดชำระ");
      return;
    }
    start(async () => {
      try {
        const res = await actRecordCombinedPayment({
          tenantId,
          amountThb: num(amount),
          paidOn,
          method,
          reference: reference || undefined,
        });
        toast.success(
          `รับชำระรวมแล้ว — ตัดเข้า ${res.billsPaid} บิล${res.leftover > 0 ? ` · เหลือทอน/ยังไม่ตัด ${res.leftover.toLocaleString()}` : ""}`,
        );
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 42,
    padding: "0 12px",
    borderRadius: 10,
    border: "1px solid var(--rs-border)",
    background: "var(--rs-bg-2)",
    color: "var(--rs-text)",
    fontSize: 14,
  };

  return (
    <>
      <button className="rs-btn !h-9 !px-3 text-[13px]" onClick={() => setOpen(true)}>
        <Banknote className="h-4 w-4" /> รับชำระรวมทุกห้อง
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-md rounded-b-none sm:rounded-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                รับชำระรวมทุกห้อง
              </div>
              <button onClick={() => setOpen(false)} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <p className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
              ระบบจะตัดยอดเข้าบิลค้างของผู้เช่ารายนี้ให้อัตโนมัติ จากบิลเก่าสุดก่อน · ยอดค้างรวม{" "}
              <b style={{ color: "var(--rs-danger)" }}>{outstanding.toLocaleString()}</b> บาท
            </p>
            <div>
              <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--rs-text-2)" }}>
                ยอดที่รับชำระ (บาท)
              </label>
              <input inputMode="decimal" style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--rs-text-2)" }}>
                  วันที่ชำระ
                </label>
                <input type="date" style={inputStyle} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div>
                <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--rs-text-2)" }}>
                  วิธีชำระ
                </label>
                <select style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  <option value="transfer">โอน</option>
                  <option value="cash">เงินสด</option>
                  <option value="qr">QR / พร้อมเพย์</option>
                  <option value="card">บัตร</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--rs-text-2)" }}>
                เลขอ้างอิง (ถ้ามี)
              </label>
              <input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <button className="rs-btn w-full justify-center" onClick={submit} disabled={pending}>
              {pending ? "กำลังบันทึก…" : "บันทึกการชำระรวม"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
