"use client";

// ขอโอนเงินบิลนี้ "บนมือถือ" (จบในที่เดียว) — CEO 2026-07-09: หลังยืนยันสลิปบนหน้าบิล LIFF
// อยากกดขอโอน + แนบ QR/เลขบัญชี ได้เลย ไม่ต้องไปทำบนเว็บ. ใช้ action เดียวกับเว็บ
// (createPaymentRequestAction) → server guard (zPayee.refine + payment.request permission)
// เป็นตัวจริง · ปุ่มส่งปิดจนกว่าจะมีปลายทางเงิน (เลขบัญชี/พร้อมเพย์/QR) = กันขอโอนลอย.
//
// CEO 2026-08-01: ปุ่มเปิด modal ย้ายไปอยู่ "ข้างปุ่มบันทึกรายการ" ในแถบล่าง (ดู LiffExpensePane)
// เดิมปุ่มนี้ไปโผล่ล่างสุดใต้ฟอร์ม CEO เลื่อนไม่เจอ. คอมโพเนนต์นี้จึงเหลือแค่ "ตัว modal"
// ที่พ่อคุม open/close ให้ (controlled).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2, Upload, X } from "lucide-react";
import { createPaymentRequestAction, sendExpenseToTrcloud } from "@/app/(admin)/ledger/_actions";
import { flushDraftCommit } from "@/lib/ledger/draft-save-registry";

export function LiffPayeeRequest({
  expenseId,
  companyId,
  classified,
  canSendTrcloud,
  poSent,
  open,
  onOpenChange,
}: {
  expenseId: string;
  companyId: string;
  /** ตั้งสาขา+หมวดครบหรือยัง — ยังไม่ครบ = ขอโอนไม่ได้ (server จะ reject). */
  classified: boolean;
  /** ผู้ใช้มีสิทธิ์ส่ง PO เข้า TRCloud ไหม (บัญชี/ผู้ดูแล) — มี = กดขอโอนทีเดียว
   *  ระบบจะยืนยันใบ+ส่ง PO ให้เองก่อนขอโอน (CEO 2026-08-01). */
  canSendTrcloud: boolean;
  /** ใบนี้ส่ง PO เข้า TRCloud แล้วหรือยัง — ส่งแล้ว = ข้ามขั้นส่ง PO. */
  poSent: boolean;
  /** เปิด modal อยู่ไหม (พ่อคุม — ปุ่มเปิดอยู่ในแถบล่างข้างปุ่มบันทึก). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [payee, setPayee] = useState({ acctName: "", bankCode: "", acctNo: "", promptpay: "", qrImageUrl: "" });
  const [qrUploading, setQrUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const payeeHasAccount =
    payee.acctNo.trim().length > 0 || payee.promptpay.trim().length > 0 || Boolean(payee.qrImageUrl);
  // ยังไม่ส่ง PO + มีสิทธิ์ส่ง → ทำ "ทีเดียว": ยืนยันใบ → ส่ง PO → ขอโอน (CEO 2026-08-01).
  const needsPoSend = canSendTrcloud && !poSent;
  // ยังไม่ส่ง PO + ไม่มีสิทธิ์ส่ง (พนักงานหน้างาน) → ขอโอนไม่ได้ ต้องให้บัญชีส่งก่อน.
  const blockedNoPoRights = !poSent && !canSendTrcloud;

  async function uploadQr(file: File) {
    if (!file.type.startsWith("image/")) {
      setMsg({ kind: "err", text: "แนบได้เฉพาะรูปภาพ QR" });
      return;
    }
    setQrUploading(true);
    setMsg(null);
    try {
      const pres = await fetch("/api/ledger/r2/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, contentType: file.type }),
      });
      const pj = (await pres.json()) as { url?: string; publicUrl?: string; error?: string };
      if (!pres.ok || !pj.url || !pj.publicUrl) throw new Error(pj.error ?? "presign");
      const put = await fetch(pj.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("upload");
      setPayee((p) => ({ ...p, qrImageUrl: pj.publicUrl as string }));
    } catch {
      setMsg({ kind: "err", text: "อัปโหลด QR ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally {
      setQrUploading(false);
    }
  }

  function submit() {
    setMsg(null);
    startTransition(async () => {
      // one-shot (CEO 2026-08-01): ใบยังไม่ส่ง PO + มีสิทธิ์ → ยืนยันใบ → ส่ง PO เข้า TRCloud →
      // ขอโอน ต่อกันในกดเดียว (เหมือน "ส่ง+ขอโอนด่วน" บนเว็บ · money-safe รอทีละสเต็ป · หยุดถ้าล้ม).
      if (needsPoSend) {
        setPhase("กำลังยืนยันใบ…");
        const committed = await flushDraftCommit(expenseId);
        if (!committed) {
          setPhase(null);
          setMsg({ kind: "err", text: "ยืนยันใบไม่สำเร็จ — กด “บันทึกรายการ” ให้ครบก่อน" });
          return;
        }
        setPhase("กำลังส่ง PO เข้า TRCloud…");
        const sent = await sendExpenseToTrcloud(expenseId);
        if (!sent.ok) {
          setPhase(null);
          setMsg({ kind: "err", text: sent.error ?? "ส่ง PO เข้า TRCloud ไม่สำเร็จ" });
          return;
        }
      }
      setPhase("กำลังสร้างคำขอโอน…");
      const res = await createPaymentRequestAction([expenseId], {
        acctName: payee.acctName.trim() || undefined,
        bankCode: payee.bankCode.trim() || undefined,
        acctNo: payee.acctNo.trim() || undefined,
        promptpay: payee.promptpay.trim() || undefined,
        qrImageUrl: payee.qrImageUrl || undefined,
      });
      setPhase(null);
      if (res.ok) {
        onOpenChange(false);
        setPayee({ acctName: "", bankCode: "", acctNo: "", promptpay: "", qrImageUrl: "" });
        router.refresh(); // หน้าจะกลับมาแสดงปุ่มล่างเป็น "✅ ขอโอนแล้ว"
      } else {
        setMsg({ kind: "err", text: res.error ?? "ขอโอนไม่สำเร็จ" });
      }
    });
  }

  const inputCls = "w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-violet-400 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={() => { if (!pending) onOpenChange(false); }}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="ขอโอนเงิน"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900">ขอโอนเงิน — ใส่ปลายทางผู้รับ</h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            aria-label="ปิด"
            className="grid size-8 place-items-center rounded-lg text-zinc-400 active:bg-zinc-100 disabled:opacity-50"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {!classified ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ตั้ง “สาขา + หมวด” ด้านบนให้ครบก่อน จึงจะส่ง PO + ขอโอนได้
          </p>
        ) : blockedNoPoRights ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ใบนี้ยังไม่ได้ส่ง PO เข้า TRCloud — แจ้งบัญชี/ผู้ดูแลให้ส่ง PO ก่อน แล้วค่อยขอโอน
          </p>
        ) : needsPoSend ? (
          <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">
            กดปุ่มเดียว = ยืนยันใบ + ส่ง PO เข้า TRCloud + ขอโอน ให้อัตโนมัติในทีเดียว
          </p>
        ) : null}

        <div className="space-y-2.5">
          <input value={payee.acctName} onChange={(e) => setPayee((p) => ({ ...p, acctName: e.target.value }))} placeholder="ชื่อบัญชีผู้รับ (ไม่บังคับ)" className={inputCls} />
          <input value={payee.bankCode} onChange={(e) => setPayee((p) => ({ ...p, bankCode: e.target.value }))} placeholder="ธนาคาร (ไม่บังคับ)" className={inputCls} />
          <input value={payee.acctNo} onChange={(e) => setPayee((p) => ({ ...p, acctNo: e.target.value }))} inputMode="numeric" placeholder="เลขบัญชี" className={inputCls} />
          <input value={payee.promptpay} onChange={(e) => setPayee((p) => ({ ...p, promptpay: e.target.value }))} inputMode="numeric" placeholder="พร้อมเพย์ (เบอร์ / เลขบัตรประชาชน)" className={inputCls} />

          <div className="flex items-center gap-3 pt-0.5">
            {payee.qrImageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={payee.qrImageUrl} alt="QR ผู้รับ" className="size-16 rounded-lg border border-zinc-200 object-cover" />
                <button type="button" onClick={() => setPayee((p) => ({ ...p, qrImageUrl: "" }))} className="text-xs font-medium text-rose-600">ลบรูป QR</button>
              </>
            ) : (
              <label className="press inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 active:bg-zinc-50">
                {qrUploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {qrUploading ? "กำลังอัปโหลด…" : "แนบรูป QR"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={qrUploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadQr(f); e.currentTarget.value = ""; }}
                />
              </label>
            )}
          </div>
        </div>

        {msg && msg.kind === "err" && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{msg.text}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={pending || !classified || !payeeHasAccount || blockedNoPoRights}
          title={
            !classified
              ? "ตั้งสาขา+หมวดก่อน"
              : blockedNoPoRights
                ? "ใบนี้ยังไม่ได้ส่ง PO — แจ้งบัญชีส่งก่อน"
                : !payeeHasAccount
                  ? "ใส่เลขบัญชี / พร้อมเพย์ หรือแนบ QR ก่อน"
                  : undefined
          }
          className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white active:bg-violet-700 disabled:bg-zinc-300"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Banknote className="size-4" aria-hidden />}
          {pending ? (phase ?? "กำลังทำ…") : needsPoSend ? "ส่ง PO + ขอโอน" : "ส่งคำขอโอน"}
        </button>
      </div>
    </div>
  );
}
