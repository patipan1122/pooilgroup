"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Percent, Download, Check, X, Send, Copy, ExternalLink, Pencil, Trash2, Plus } from "lucide-react";
import {
  actRecordPayment,
  actRequestDiscount,
  actDecideDiscount,
  actRequestVoidBill,
  actDecideVoidBill,
  actUploadFile,
  actSendBill,
  actEditBillItems,
  actDeleteBill,
} from "../../../_actions";
import { formatBaht, thaiDateLong } from "@/lib/rentspace/format";

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
      {/* flex-col + max-h → หัว/ปุ่มบันทึกติดขอบเห็นตลอด · เนื้อหายาว (หลายรายการ) เลื่อนตรงกลางได้ ไม่ล้นจอ */}
      <div
        className="rs-card w-full sm:max-w-lg rounded-b-none sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[88dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--rs-border)" }}>
          <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
            {title}
          </div>
          <button onClick={onClose} disabled={pending} className="p-1.5 rounded-lg hover:bg-black/5 min-h-[40px] min-w-[40px] flex items-center justify-center">
            <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1 overscroll-contain">{children}</div>
        <div className="flex gap-2 px-5 py-3 border-t shrink-0" style={{ borderColor: "var(--rs-border)" }}>
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

  // Slip rule (จุด 5): digital payments (โอน/QR/บัตร) leave a slip → require it as
  // proof. เงินสด has no slip → optional. So the requirement follows the method.
  const slipRequired = method !== "cash";

  function submit() {
    if (num(amount) <= 0) return toast.error("กรุณากรอกจำนวนเงิน");
    const f = fileRef.current?.files?.[0];
    if (slipRequired && !f) return toast.error("วิธีนี้ต้องแนบสลิป — ถ้าเป็นเงินสดให้เลือกวิธีชำระ “เงินสด”");
    start(async () => {
      try {
        let slipUrl: string | undefined;
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
      <button className="rs-btn w-full min-h-[44px] sm:min-h-0" onClick={() => setOpen(true)}>
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
              สลิป{" "}
              {slipRequired ? (
                <span style={{ color: "var(--rs-danger)" }}>(บังคับ)</span>
              ) : (
                <span style={{ color: "var(--rs-text-3)" }}>(ไม่บังคับ — เงินสด)</span>
              )}
            </label>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="text-[13px]" />
            <p className="text-[11.5px] mt-1" style={{ color: "var(--rs-text-3)" }}>
              {slipRequired
                ? "โอน / QR / บัตร ต้องแนบสลิปเป็นหลักฐานการรับเงิน"
                : "เงินสดไม่ต้องแนบสลิปก็บันทึกได้"}
            </p>
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
      <button className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0" onClick={() => setOpen(true)}>
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
        className="inline-flex items-center justify-center size-11 sm:size-10 rounded-lg"
        style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}
        aria-label="อนุมัติส่วนลด"
        title="อนุมัติ"
        disabled={pending}
        onClick={() => decide("approved")}
      >
        <Check className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        className="inline-flex items-center justify-center size-11 sm:size-10 rounded-lg"
        style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
        aria-label="ไม่อนุมัติส่วนลด"
        title="ไม่อนุมัติ"
        disabled={pending}
        onClick={() => decide("rejected")}
      >
        <X className="h-4 w-4" aria-hidden="true" />
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

  const sendLabel = pending
    ? "กำลังสร้างลิงก์…"
    : url
      ? "ส่งบิลอีกครั้ง (อัปเดตลิงก์)"
      : "ส่งบิล (คัดลอกลิงก์)";

  return (
    <div className="space-y-2">
      <button
        className="rs-btn w-full min-h-[44px] sm:min-h-0"
        onClick={send}
        disabled={pending}
        aria-label={url ? "ส่งบิลอีกครั้ง — สร้างลิงก์ใหม่ให้ผู้เช่า" : "ส่งบิล — สร้างลิงก์ให้ผู้เช่า"}
        aria-busy={pending ? "true" : "false"}
      >
        <Send className="h-4 w-4" aria-hidden="true" /> {sendLabel}
      </button>

      {sentAt && (
        <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
          ส่งแล้วเมื่อ {thaiDateLong(new Date(sentAt))}
        </div>
      )}

      {/* aria-live: announce the generated public link (and its appearance)
          to screen readers once "ส่งบิล" succeeds. */}
      <div aria-live="polite">
        {url && (
          <div
            className="rounded-xl p-2.5 space-y-2"
            style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
          >
            <div className="text-[11.5px] break-all" style={{ color: "var(--rs-text-2)" }}>
              {url}
            </div>
            <div className="flex gap-2">
              <button className="rs-btn rs-btn-ghost flex-1" onClick={copy} aria-label="คัดลอกลิงก์บิล">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> คัดลอกลิงก์
              </button>
              <a
                className="rs-btn rs-btn-ghost flex-1"
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label="เปิดดูบิลในแท็บใหม่"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> เปิดดู
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── print ─────────
export function PrintBillButton() {
  return (
    <button className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0" onClick={() => window.print()}>
      <Download className="h-4 w-4" /> ดาวน์โหลด / พิมพ์ PDF
    </button>
  );
}

// ───────── void: ขออนุมัติ (maker) ─────────
export function RequestVoidButton({ billId }: { billId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    const reason = prompt("เหตุผลที่ขอยกเลิกบิลนี้?\n(ต้องให้แอดมินอีกคนอนุมัติก่อนบิลจะถูกยกเลิกจริง)");
    if (reason == null) return;
    if (reason.trim().length < 3) {
      toast.error("กรุณาระบุเหตุผลการยกเลิก");
      return;
    }
    start(async () => {
      try {
        await actRequestVoidBill(billId, reason.trim());
        toast.success("ส่งคำขอยกเลิกแล้ว — รอแอดมินอีกคนอนุมัติ");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ส่งคำขอไม่สำเร็จ");
      }
    });
  }
  return (
    <button className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0" style={{ color: "var(--rs-danger)" }} onClick={go} disabled={pending}>
      ขอยกเลิกบิล
    </button>
  );
}

// ───────── void: อนุมัติ/ปฏิเสธ (checker) ─────────
export function VoidDecisionButtons({ billId }: { billId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function decide(decision: "approve" | "reject") {
    if (decision === "approve" && !confirm("ยืนยันอนุมัติยกเลิกบิลนี้? บิลจะไม่ถูกนำไปคำนวณยอดค้างอีก")) return;
    const note = decision === "reject" ? prompt("เหตุผลที่ไม่อนุมัติ (ถ้ามี)") ?? "" : "";
    start(async () => {
      try {
        await actDecideVoidBill(billId, decision, note);
        toast.success(decision === "approve" ? "อนุมัติยกเลิกบิลแล้ว" : "ปฏิเสธคำขอยกเลิกแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
      }
    });
  }
  return (
    <div className="flex gap-2">
      <button className="rs-btn flex-1 min-h-[44px] sm:min-h-0" onClick={() => decide("approve")} disabled={pending}>
        <Check className="h-4 w-4" /> อนุมัติยกเลิก
      </button>
      <button
        className="rs-btn rs-btn-ghost flex-1 min-h-[44px] sm:min-h-0"
        style={{ color: "var(--rs-danger)" }}
        onClick={() => decide("reject")}
        disabled={pending}
      >
        <X className="h-4 w-4" /> ปฏิเสธ
      </button>
    </div>
  );
}

// ───────── โหมดทดลอง: แก้ไขรายการบิล ─────────
type EditableItem = { kind: string; label: string; amount: string; vatable: boolean };

const BILL_KIND_OPTS: { value: string; label: string }[] = [
  { value: "rent", label: "ค่าเช่า" },
  { value: "electric", label: "ค่าไฟ" },
  { value: "water", label: "ค่าน้ำ" },
  { value: "late_fee", label: "ค่าปรับล่าช้า" },
  { value: "land_tax", label: "ภาษีที่ดิน (ไม่คิด VAT)" },
  { value: "custom", label: "ค่าใช้จ่ายเพิ่มเติม" },
  { value: "other", label: "อื่น ๆ" },
];

export function EditBillButton({
  billId,
  items,
  vatPercent = 0,
}: {
  billId: string;
  items: { kind: string; label: string; amount: number; vatable: boolean }[];
  vatPercent?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<EditableItem[]>([]);

  function openModal() {
    setRows(
      (items.length ? items : [{ kind: "other", label: "", amount: 0, vatable: false }]).map((it) => ({
        kind: BILL_KIND_OPTS.some((o) => o.value === it.kind) ? it.kind : "other",
        label: it.label,
        amount: String(it.amount),
        vatable: it.vatable,
      })),
    );
    setOpen(true);
  }
  function patch(i: number, p: Partial<EditableItem>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { kind: "other", label: "", amount: "", vatable: false }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ───── พรีวิวบิลสด — คิดยอดเหมือน computeBillTotals ฝั่งเซิร์ฟเวอร์ ─────
  // subtotal = รวมทุก item · VAT คิดเฉพาะ item ที่ติ๊ก "คิด VAT" (land_tax ไม่คิด)
  // หมายเหตุ: ส่วนลดที่อนุมัติแล้วจะถูกหักเพิ่มฝั่งเซิร์ฟเวอร์ตอนบันทึก —
  // พรีวิวนี้แสดงยอด "ก่อนส่วนลด" เพื่อให้เห็นผลของการแก้ item ทันที.
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const previewSubtotal = round2(
    rows.reduce((s, r) => s + (Number.isFinite(num(r.amount)) ? num(r.amount) : 0), 0),
  );
  const previewVatBase = round2(
    rows.reduce((s, r) => s + (r.vatable && Number.isFinite(num(r.amount)) ? num(r.amount) : 0), 0),
  );
  const previewVat = round2(previewVatBase * (vatPercent / 100));
  const previewTotal = round2(previewSubtotal + previewVat);

  function submit() {
    const clean = rows
      .map((r) => ({ kind: r.kind, label: r.label.trim(), amount: num(r.amount), vatable: r.vatable }))
      .filter((r) => Number.isFinite(r.amount) && r.amount >= 0);
    if (clean.length === 0) return toast.error("ต้องมีรายการอย่างน้อย 1 รายการ (ยอด ≥ 0)");
    start(async () => {
      try {
        await actEditBillItems({ billId, items: clean });
        toast.success("แก้ไขบิลแล้ว — คิดยอดรวมใหม่ให้เรียบร้อย");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "แก้ไขไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0" onClick={openModal}>
        <Pencil className="h-4 w-4" /> แก้ไขบิล
      </button>
      {open && (
        <Modal title="แก้ไขรายการบิล" onClose={() => setOpen(false)} pending={pending} onSubmit={submit} submitLabel="บันทึก + คิดยอดใหม่">
          <p className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            แก้ตัวเลขแต่ละรายการได้เลย ระบบจะคิดยอดรวม + VAT ใหม่ให้อัตโนมัติ (ส่วนลดที่อนุมัติแล้วยังคำนวณต่อ)
          </p>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div
                key={i}
                className="rounded-xl p-2.5 space-y-2"
                style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
              >
                <div className="flex items-center gap-2">
                  <select
                    className="rs-d-input"
                    style={{ height: 38, flex: 1 }}
                    value={r.kind}
                    onChange={(e) => {
                      const kind = e.target.value;
                      // ภาษีที่ดินเป็นภาษีส่งผ่าน → บังคับไม่คิด VAT ทันทีเพื่อกัน base พอง
                      patch(i, kind === "land_tax" ? { kind, vatable: false } : { kind });
                    }}
                    aria-label="ประเภทรายการ"
                  >
                    {BILL_KIND_OPTS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="inline-flex items-center justify-center h-9 w-9 rounded-lg shrink-0"
                    style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
                    aria-label="ลบรายการนี้"
                    title="ลบรายการนี้"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="rs-d-input"
                  style={{ height: 38 }}
                  value={r.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  placeholder="ชื่อรายการ (เช่น ค่าไฟ 120 หน่วย)"
                  aria-label="ชื่อรายการ"
                />
                <div className="flex items-center gap-3">
                  <input
                    className="rs-d-input"
                    style={{ height: 38, flex: 1 }}
                    inputMode="decimal"
                    value={r.amount}
                    onChange={(e) => patch(i, { amount: e.target.value })}
                    placeholder="ยอด (บาท)"
                    aria-label="ยอดเงิน (บาท)"
                  />
                  <label className="flex items-center gap-1.5 text-[12.5px] shrink-0" style={{ color: "var(--rs-text-2)" }}>
                    <input type="checkbox" checked={r.vatable} onChange={(e) => patch(i, { vatable: e.target.checked })} />
                    คิด VAT
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow} className="rs-btn rs-btn-ghost w-full">
            <Plus className="h-4 w-4" /> เพิ่มรายการ
          </button>

          {/* พรีวิวบิลสด — อัปเดตยอดทันทีที่แก้รายการ */}
          <div
            className="rounded-xl p-3 mt-1"
            style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
          >
            <div className="text-[11.5px] font-semibold uppercase mb-1.5" style={{ color: "var(--rs-text-3)" }}>
              พรีวิวบิลสด
            </div>
            <div className="flex items-center justify-between py-0.5 text-[13px]">
              <span style={{ color: "var(--rs-text-2)" }}>ยอดก่อนภาษี</span>
              <span className="tabular-nums font-medium" style={{ color: "var(--rs-text)" }}>
                {formatBaht(previewSubtotal)}
              </span>
            </div>
            {vatPercent > 0 && (
              <div className="flex items-center justify-between py-0.5 text-[13px]">
                <span style={{ color: "var(--rs-text-2)" }}>ภาษีมูลค่าเพิ่ม (VAT {vatPercent}%)</span>
                <span className="tabular-nums font-medium" style={{ color: "var(--rs-text)" }}>
                  {formatBaht(previewVat)}
                </span>
              </div>
            )}
            <div
              className="flex items-center justify-between pt-1.5 mt-1"
              style={{ borderTop: "1px solid var(--rs-border)" }}
            >
              <span className="text-[13.5px] font-semibold" style={{ color: "var(--rs-text)" }}>
                ยอดรวมทั้งสิ้น
              </span>
              <span className="text-[15px] font-bold tabular-nums" style={{ color: "var(--rs-brand)" }}>
                {formatBaht(previewTotal)}
              </span>
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: "var(--rs-text-3)" }}>
              VAT คิดเฉพาะรายการที่ติ๊ก “คิด VAT” · ส่วนลดที่อนุมัติแล้วจะหักเพิ่มตอนบันทึก
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

// ───────── โหมดทดลอง: ลบบิลถาวร ─────────
export function DeleteBillButton({
  billId,
  billNo,
  hasPayments,
}: {
  billId: string;
  billNo: string;
  hasPayments: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    const warn = hasPayments
      ? `ลบบิล ${billNo} ถาวร?\n\n⚠️ บิลนี้มีประวัติการรับชำระเงิน — จะถูกลบไปด้วยทั้งหมด กู้คืนไม่ได้`
      : `ลบบิล ${billNo} ถาวร? กู้คืนไม่ได้`;
    if (!confirm(warn)) return;
    start(async () => {
      try {
        await actDeleteBill(billId);
        toast.success(`ลบบิล ${billNo} แล้ว`);
        router.push("/rentspace/bills");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }
  return (
    <button className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0" style={{ color: "var(--rs-danger)" }} onClick={go} disabled={pending}>
      <Trash2 className="h-4 w-4" /> ลบบิลถาวร
    </button>
  );
}
