"use client";

// ขอโอนงวดนี้ (P2-B) — bottom-sheet มือถือ / dialog เดสก์ท็อป (โครงเดียวกับ MarkPaidSheet).
// ใส่ปลายทางผู้รับ (ชื่อบัญชี/ธนาคาร/เลขบัญชี/พร้อมเพย์/แนบ QR) → requestInstallmentTransferAction
// → งวดเป็น amber "ขอโอนแล้ว—รอโอน" + ดันการ์ดเข้ากลุ่มผู้บริหาร · เขียวเองเมื่อสลิปเข้า.
// ปุ่มส่งปิดจนกว่าจะมีปลายทางเงิน ≥1 (เลขบัญชี/พร้อมเพย์/QR) = mirror server refine กันขอโอนลอย.
// ฟอร์มผู้รับ + อัป QR (presign→PUT→publicUrl) ยืมสำนวนจาก LiffPayeeRequest (ไม่ import — คนละ surface).

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2, Upload, X } from "lucide-react";
import { requestInstallmentTransferAction } from "@/app/(admin)/ledger/_actions";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

const inputCls =
  "w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-[var(--color-brand-400)] focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-600";

export function RequestTransferSheet({
  installmentId,
  installmentLabel,
  seq,
  plannedAmount,
  companyId,
}: {
  installmentId: string;
  installmentLabel: string;
  seq: number;
  plannedAmount: number;
  companyId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [payee, setPayee] = useState({
    acctName: "",
    bankCode: "",
    acctNo: "",
    promptpay: "",
    qrImageUrl: "",
  });
  const [qrUploading, setQrUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ปิดด้วย Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  // ต้องมีปลายทางเงินอย่างน้อย 1 อย่าง (mirror server zPayee.refine)
  const payeeHasAccount =
    payee.acctNo.trim().length > 0 ||
    payee.promptpay.trim().length > 0 ||
    Boolean(payee.qrImageUrl);

  async function uploadQr(file: File) {
    if (!file.type.startsWith("image/")) {
      setErr("แนบได้เฉพาะรูปภาพ QR");
      return;
    }
    setQrUploading(true);
    setErr(null);
    try {
      const pres = await fetch("/api/ledger/r2/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, contentType: file.type }),
      });
      const pj = (await pres.json()) as { url?: string; publicUrl?: string; error?: string };
      if (!pres.ok || !pj.url || !pj.publicUrl) throw new Error(pj.error ?? "presign");
      const put = await fetch(pj.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("upload");
      setPayee((p) => ({ ...p, qrImageUrl: pj.publicUrl as string }));
    } catch {
      setErr("อัปโหลด QR ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setQrUploading(false);
    }
  }

  function submit() {
    setErr(null);
    startTransition(async () => {
      const res = await requestInstallmentTransferAction(installmentId, {
        acctName: payee.acctName.trim() || undefined,
        bankCode: payee.bankCode.trim() || undefined,
        acctNo: payee.acctNo.trim() || undefined,
        promptpay: payee.promptpay.trim() || undefined,
        qrImageUrl: payee.qrImageUrl || undefined,
      });
      if (res.ok) {
        setOpen(false);
        setPayee({ acctName: "", bankCode: "", acctNo: "", promptpay: "", qrImageUrl: "" });
        router.refresh();
      } else {
        setErr(res.error ?? "ขอโอนไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setOpen(true);
        }}
        className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-2.5 text-xs font-semibold text-[var(--color-brand-700)] transition-colors hover:bg-[var(--color-brand-100)]"
      >
        <Banknote className="size-3.5" aria-hidden /> ขอโอนงวดนี้
      </button>

      {open && (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => {
            if (!pending) setOpen(false);
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="ขอโอนงวดนี้ — ใส่ปลายทางผู้รับ"
            onClick={(e) => e.stopPropagation()}
          >
            {/* หัว sheet */}
            <div className="flex items-start justify-between gap-2 border-b border-zinc-100 p-4">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-zinc-900">
                  ขอโอน · {installmentLabel}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  ขอโอน งวด {seq} ·{" "}
                  <span className="font-semibold tabular-nums text-zinc-700">
                    {baht(plannedAmount)}
                  </span>{" "}
                  — ใส่ปลายทางผู้รับ แล้วส่งเข้ากลุ่มผู้บริหารเพื่อโอน
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                aria-label="ปิด"
                className="press grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            {/* ฟอร์มผู้รับ */}
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              <div>
                <label className={labelCls}>ชื่อบัญชีผู้รับ (ไม่บังคับ)</label>
                <input
                  value={payee.acctName}
                  onChange={(e) => setPayee((p) => ({ ...p, acctName: e.target.value }))}
                  placeholder="เช่น หจก. ช่างสมชาย"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>ธนาคาร (ไม่บังคับ)</label>
                <input
                  value={payee.bankCode}
                  onChange={(e) => setPayee((p) => ({ ...p, bankCode: e.target.value }))}
                  placeholder="เช่น กสิกรไทย / SCB"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>เลขบัญชี</label>
                <input
                  value={payee.acctNo}
                  onChange={(e) => setPayee((p) => ({ ...p, acctNo: e.target.value }))}
                  inputMode="numeric"
                  placeholder="เลขบัญชีธนาคาร"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>พร้อมเพย์</label>
                <input
                  value={payee.promptpay}
                  onChange={(e) => setPayee((p) => ({ ...p, promptpay: e.target.value }))}
                  inputMode="numeric"
                  placeholder="เบอร์ / เลขบัตรประชาชน"
                  className={inputCls}
                />
              </div>

              {/* แนบ QR ผู้รับ */}
              <div>
                <label className={labelCls}>แนบรูป QR (ไม่บังคับ)</label>
                <div className="flex items-center gap-3">
                  {payee.qrImageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={payee.qrImageUrl}
                        alt="QR ผู้รับ"
                        className="size-16 rounded-lg border border-zinc-200 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPayee((p) => ({ ...p, qrImageUrl: "" }))}
                        className="text-xs font-medium text-rose-600"
                      >
                        ลบรูป QR
                      </button>
                    </>
                  ) : (
                    <label className="press inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50">
                      {qrUploading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Upload className="size-4" aria-hidden />
                      )}
                      {qrUploading ? "กำลังอัปโหลด…" : "แนบรูป QR"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={qrUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadQr(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-zinc-400">
                ใส่อย่างน้อย 1 อย่าง: เลขบัญชี · พร้อมเพย์ หรือแนบ QR ผู้รับ
              </p>

              {err && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>
              )}
            </div>

            {/* ปุ่มส่ง — ปิดจนกว่าจะมีปลายทางเงิน */}
            <div className="border-t border-zinc-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={submit}
                disabled={pending || !payeeHasAccount}
                title={!payeeHasAccount ? "ใส่เลขบัญชี / พร้อมเพย์ หรือแนบ QR ก่อน" : undefined}
                className="press flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-700)] disabled:bg-zinc-300"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Banknote className="size-4" aria-hidden />
                )}
                ส่งคำขอโอน
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
