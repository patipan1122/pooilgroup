"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Check, PenLine, Printer, X } from "lucide-react";
import { actGenerateSignLink, actTerminateContract, actRecordDeposit, actUploadFile } from "../../../_actions";

const DEPOSIT_KINDS: Record<string, string> = {
  collect: "รับเงินประกัน",
  refund: "คืนเงินประกัน",
  deduct: "หักจากประกัน",
  forfeit: "ยึดประกัน",
};

function num(v: string): number {
  const n = Number(v.replace(/,/g, ""));
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

// ───────── sign link ─────────
export function SignLinkBox({
  contractId,
  origin,
  initialToken,
}: {
  contractId: string;
  origin: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const url = token ? `${origin}/sign/rentspace/${token}` : "";

  function gen() {
    start(async () => {
      try {
        const r = await actGenerateSignLink(contractId);
        setToken(r.token);
        toast.success("สร้างลิงก์เซ็นสัญญาแล้ว");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "สร้างลิงก์ไม่สำเร็จ");
      }
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("คัดลอกลิงก์แล้ว");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  if (!token) {
    return (
      <button className="rs-btn" onClick={gen} disabled={pending}>
        <PenLine className="h-4 w-4" /> {pending ? "กำลังสร้าง…" : "สร้างลิงก์เซ็นสัญญาออนไลน์"}
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 h-10 px-3 rounded-lg text-[13px] tabular-nums"
          style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)", color: "var(--rs-text)" }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button className="rs-btn rs-btn-ghost" onClick={copy}>
          {copied ? <Check className="h-4 w-4" style={{ color: "var(--rs-ok)" }} /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <button className="text-[12.5px] font-medium" style={{ color: "var(--rs-brand)" }} onClick={gen} disabled={pending}>
        สร้างลิงก์ใหม่ (ลิงก์เดิมจะใช้ไม่ได้)
      </button>
    </div>
  );
}

// ───────── print ─────────
export function PrintButton() {
  return (
    <button className="rs-btn rs-btn-ghost" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> พิมพ์สัญญา
    </button>
  );
}

// ───────── terminate ─────────
export function TerminateButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    if (!confirm("ยืนยันยกเลิกสัญญานี้? ห้องจะกลับเป็นสถานะว่าง")) return;
    start(async () => {
      try {
        await actTerminateContract(contractId);
        toast.success("ยกเลิกสัญญาแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ");
      }
    });
  }
  return (
    <button
      className="rs-btn rs-btn-ghost"
      style={{ color: "var(--rs-danger)" }}
      onClick={go}
      disabled={pending}
    >
      ยกเลิกสัญญา
    </button>
  );
}

// ───────── record deposit ─────────
export function RecordDepositButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<"collect" | "refund" | "deduct" | "forfeit">("collect");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");

  function submit() {
    if (num(amount) <= 0) return toast.error("กรุณากรอกจำนวนเงิน");
    start(async () => {
      try {
        let slipUrl: string | undefined;
        const f = fileRef.current?.files?.[0];
        if (f) {
          const dataUrl = await fileToDataUrl(f);
          const up = await actUploadFile({ sub: "deposit-slip", dataUrl });
          slipUrl = up.url;
        }
        await actRecordDeposit({
          contractId,
          kind,
          amountThb: num(amount),
          occurredOn,
          method,
          slipUrl,
          note: note || undefined,
        });
        toast.success("บันทึกเงินประกันแล้ว");
        setOpen(false);
        setAmount("");
        setNote("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button className="rs-btn rs-btn-ghost" onClick={() => setOpen(true)}>
        บันทึกเงินประกัน
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 print:hidden"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-md rounded-b-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--rs-border)" }}
            >
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                บันทึกเงินประกัน
              </div>
              <button onClick={() => setOpen(false)} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  ประเภท
                </label>
                <select className="rs-d-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  {Object.entries(DEPOSIT_KINDS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                    จำนวนเงิน (บาท)
                  </label>
                  <input inputMode="decimal" className="rs-d-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                    วันที่
                  </label>
                  <input type="date" className="rs-d-input" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  วิธีรับ/จ่าย
                </label>
                <select className="rs-d-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">เงินสด</option>
                  <option value="transfer">โอน</option>
                  <option value="qr">QR / พร้อมเพย์</option>
                  <option value="card">บัตร</option>
                </select>
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
            </div>
            <div className="flex gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
              <button className="rs-btn rs-btn-ghost flex-1" disabled={pending} onClick={() => setOpen(false)}>
                ยกเลิก
              </button>
              <button className="rs-btn flex-1" disabled={pending} onClick={submit}>
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
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
    </>
  );
}
