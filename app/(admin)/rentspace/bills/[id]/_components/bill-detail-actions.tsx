"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Percent, Download, Check, X, Send, Copy, ExternalLink } from "lucide-react";
import {
  actRecordPayment,
  actRequestDiscount,
  actDecideDiscount,
  actVoidBill,
  actUploadFile,
  actSendBill,
} from "../../../_actions";
import { thaiDateLong } from "@/lib/rentspace/format";

function num(v: string): number {
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

const FIELD_STYLE = (
  <style jsx>{`
    :global(.rs-d-input) {
      width: 100%;
      height: 42px;
      padding: 0 12px;
      border-radius: 10px;
      border: 1px solid var(--rs-border);
      background: var(--rs-bg-2);
      color: var(--rs-text);
      font-size: 14px;
    }
    :global(textarea.rs-d-input) {
      height: auto;
      padding: 10px 12px;
    }
    :global(.rs-d-input:focus) {
      outline: none;
      border-color: var(--rs-brand);
      background: #fff;
    }
  `}</style>
);

function Modal({
  title,
  onClose,
  pending,
  onSubmit,
  submitLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  pending: boolean;
  onSubmit: () => void;
  submitLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 print:hidden"
      onClick={() => !pending && onClose()}
    >
      <div className="rs-card w-full sm:max-w-md rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--rs-border)" }}>
          <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
            {title}
          </div>
          <button onClick={onClose} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
            <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">{children}</div>
        <div className="flex gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
          <button className="rs-btn rs-btn-ghost flex-1" disabled={pending} onClick={onClose}>
            ยกเลิก
          </button>
          <button className="rs-btn flex-1" disabled={pending} onClick={onSubmit}>
            {pending ? "กำลังบันทึก…" : submitLabel}
          </button>
        </div>
      </div>
      {FIELD_STYLE}
    </div>
  );
}

// ───────── record payment ─────────
export function RecordPaymentButton({ billId, remaining }: { billId: string; remaining: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : "");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<"cash" | "transfer" | "qr" | "card">("transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    if (num(amount) <= 0) return toast.error("กรุณากรอกจำนวนเงิน");
    start(async () => {
      try {
        let slipUrl: string | undefined;
        const f = fileRef.current?.files?.[0];
        if (f) {
          const dataUrl = await fileToDataUrl(f);
          const up = await actUploadFile({ sub: "payment-slip", dataUrl });
          slipUrl = up.url;
        }
        await actRecordPayment({
          billId,
          amountThb: num(amount),
          paidOn,
          method,
          reference: reference || undefined,
          slipUrl,
          note: note || undefined,
        });
        toast.success("บันทึกรับชำระแล้ว");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button className="rs-btn w-full" onClick={() => setOpen(true)}>
        <Banknote className="h-4 w-4" /> บันทึกรับชำระ
      </button>
      {open && (
        <Modal title="บันทึกรับชำระ" onClose={() => setOpen(false)} pending={pending} onSubmit={submit} submitLabel="บันทึก">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                จำนวนเงิน (บาท)
              </label>
              <input inputMode="decimal" className="rs-d-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                วันที่ชำระ
              </label>
              <input type="date" className="rs-d-input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
              วิธีชำระ
            </label>
            <select className="rs-d-input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="cash">เงินสด</option>
              <option value="transfer">โอน</option>
              <option value="qr">QR / พร้อมเพย์</option>
              <option value="card">บัตร</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
              เลขอ้างอิง (ไม่บังคับ)
            </label>
            <input className="rs-d-input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
              สลิป (ไม่บังคับ)
            </label>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="text-[13px]" />
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
              หมายเหตุ
            </label>
            <textarea className="rs-d-input min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  );
}

// ───────── request discount ─────────
export function RequestDiscountButton({ billId }: { billId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [kind, setKind] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  function submit() {
    if (num(value) <= 0) return toast.error("กรุณากรอกจำนวนส่วนลด");
    if (kind === "percent" && num(value) > 100) return toast.error("เปอร์เซ็นต์ต้องไม่เกิน 100");
    start(async () => {
      try {
        await actRequestDiscount({ billId, kind, value: num(value), reason: reason || undefined });
        toast.success("ส่งคำขอส่วนลดแล้ว — รออนุมัติ");
        setOpen(false);
        setValue("");
        setReason("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ส่งคำขอไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button className="rs-btn rs-btn-ghost w-full" onClick={() => setOpen(true)}>
        <Percent className="h-4 w-4" /> ขอส่วนลด
      </button>
      {open && (
        <Modal title="ขอส่วนลด" onClose={() => setOpen(false)} pending={pending} onSubmit={submit} submitLabel="ส่งคำขอ">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                ประเภท
              </label>
              <select className="rs-d-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="amount">จำนวนเงิน (บาท)</option>
                <option value="percent">เปอร์เซ็นต์ (%)</option>
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                {kind === "percent" ? "ส่วนลด (%)" : "ส่วนลด (บาท)"}
              </label>
              <input inputMode="decimal" className="rs-d-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
              เหตุผล
            </label>
            <textarea className="rs-d-input min-h-[56px]" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  );
}

// ───────── approve / reject discount (admin only) ─────────
export function DiscountDecisionButtons({ discountId }: { discountId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function decide(decision: "approved" | "rejected") {
    if (decision === "rejected" && !confirm("ไม่อนุมัติส่วนลดนี้?")) return;
    start(async () => {
      try {
        await actDecideDiscount(discountId, decision);
        toast.success(decision === "approved" ? "อนุมัติส่วนลดแล้ว" : "ไม่อนุมัติส่วนลดแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg"
        style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}
        title="อนุมัติ"
        disabled={pending}
        onClick={() => decide("approved")}
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg"
        style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
        title="ไม่อนุมัติ"
        disabled={pending}
        onClick={() => decide("rejected")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ───────── send bill (public link) ─────────
export function SendBillButton({
  billId,
  initialSentAt,
  initialUrl,
}: {
  billId: string;
  initialSentAt: string | null;
  initialUrl: string | null;
}) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [sentAt, setSentAt] = useState<string | null>(initialSentAt);

  function send() {
    start(async () => {
      try {
        const r = await actSendBill(billId);
        setUrl(r.url);
        setSentAt(new Date().toISOString());
        toast.success("สร้างลิงก์บิลแล้ว — คัดลอกแล้วส่งให้ผู้เช่าได้เลย");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ส่งบิลไม่สำเร็จ");
      }
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("คัดลอกลิงก์แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — กดค้างที่ลิงก์เพื่อคัดลอกเอง");
    }
  }

  return (
    <div className="space-y-2">
      <button className="rs-btn w-full" onClick={send} disabled={pending}>
        <Send className="h-4 w-4" /> {pending ? "กำลังสร้างลิงก์…" : url ? "ส่งบิลอีกครั้ง (อัปเดตลิงก์)" : "ส่งบิล (คัดลอกลิงก์)"}
      </button>

      {sentAt && (
        <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
          ส่งแล้วเมื่อ {thaiDateLong(new Date(sentAt))}
        </div>
      )}

      {url && (
        <div
          className="rounded-xl p-2.5 space-y-2"
          style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
        >
          <div className="text-[11.5px] break-all" style={{ color: "var(--rs-text-2)" }}>
            {url}
          </div>
          <div className="flex gap-2">
            <button className="rs-btn rs-btn-ghost flex-1" onClick={copy}>
              <Copy className="h-3.5 w-3.5" /> คัดลอกลิงก์
            </button>
            <a className="rs-btn rs-btn-ghost flex-1" href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> เปิดดู
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── print ─────────
export function PrintBillButton() {
  return (
    <button className="rs-btn rs-btn-ghost w-full" onClick={() => window.print()}>
      <Download className="h-4 w-4" /> ดาวน์โหลด / พิมพ์ PDF
    </button>
  );
}

// ───────── void ─────────
export function VoidBillButton({ billId }: { billId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    if (!confirm("ยืนยันยกเลิกบิลนี้? บิลที่ยกเลิกจะไม่ถูกนำไปคำนวณยอดค้าง")) return;
    start(async () => {
      try {
        await actVoidBill(billId);
        toast.success("ยกเลิกบิลแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ");
      }
    });
  }
  return (
    <button className="rs-btn rs-btn-ghost w-full" style={{ color: "var(--rs-danger)" }} onClick={go} disabled={pending}>
      ยกเลิกบิล
    </button>
  );
}
