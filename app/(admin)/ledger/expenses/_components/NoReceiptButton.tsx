"use client";

// ปุ่มเดียว "เพิ่มค่าใช้จ่ายไม่มีใบเสร็จ" (combine flow, D6).
// กรอกผู้รับเงิน/ยอด/หมวด/เหตุผล → สร้างใบร่าง (createNoReceiptExpense, ไม่มีรูป) →
// เด้งไปที่ใบนั้น เพื่อให้บัญชียืนยัน แล้วกด "ออกใบรับรองแทนใบเสร็จ" (เหตุผล pre-fill).
// gate SUB เดิมไม่แตะ — นี่คือ "ทางเข้าเดียว" ไม่ใช่การปลด gate.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, X, Loader2 } from "lucide-react";
import { createNoReceiptExpense } from "../../_actions";

type Opt = { id: string; name: string };

export function NoReceiptButton({
  companyId,
  branchId,
  categories,
  branches,
}: {
  companyId: string;
  branchId: string | null;
  categories: Opt[];
  branches: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [vendor, setVendor] = useState("");
  const [total, setTotal] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [branch, setBranch] = useState(branchId ?? "");
  const [docDate, setDocDate] = useState("");
  const [reason, setReason] = useState("");

  function reset() {
    setVendor("");
    setTotal("");
    setCategoryId("");
    setBranch(branchId ?? "");
    setDocDate("");
    setReason("");
    setError(null);
  }

  function submit() {
    setError(null);
    const amount = Number(total.replace(/,/g, ""));
    if (!vendor.trim()) return setError("กรุณาระบุชื่อร้าน/ผู้รับเงิน");
    if (!(amount > 0)) return setError("กรุณาระบุยอดเงินมากกว่า 0");
    if (reason.trim().length < 3) return setError("กรุณาระบุเหตุผลที่ไม่มีใบเสร็จ");
    startTransition(async () => {
      const res = await createNoReceiptExpense({
        companyId,
        vendor: vendor.trim(),
        total: amount,
        reason: reason.trim(),
        categoryId: categoryId || null,
        branchId: branch || null,
        docDate: docDate || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      // เด้งไปที่ใบร่างที่เพิ่งสร้าง → บัญชียืนยัน → ออกใบรับรองแทนใบเสร็จ
      router.push(`/ledger/expenses?company=${encodeURIComponent(companyId)}&selected=${encodeURIComponent(res.id)}`);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <FilePlus2 className="size-4" />
        ไม่มีใบเสร็จ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-900">เพิ่มค่าใช้จ่ายไม่มีใบเสร็จ</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="size-5" />
              </button>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              สำหรับค่าใช้จ่ายที่ไม่มีใบเสร็จ (ค่ารถ ค่าถ่ายเอกสาร ฯลฯ) — บันทึกแล้วบัญชียืนยัน
              จากนั้นออก “ใบรับรองแทนใบเสร็จ” ได้เลย
            </p>

            {error && (
              <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}

            <div className="space-y-2.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">ร้าน / ผู้รับเงิน *</label>
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm focus:border-[var(--color-brand-400)] focus:outline-none"
                  placeholder="เช่น ค่าแท็กซี่"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">ยอดเงิน (บาท) *</label>
                  <input
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    inputMode="decimal"
                    className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm focus:border-[var(--color-brand-400)] focus:outline-none"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">วันที่</label>
                  <input
                    type="date"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm focus:border-[var(--color-brand-400)] focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">หมวดหมู่</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="h-11 w-full rounded-lg border border-zinc-200 px-2 text-sm focus:border-[var(--color-brand-400)] focus:outline-none"
                  >
                    <option value="">— เลือก —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">สาขา</label>
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="h-11 w-full rounded-lg border border-zinc-200 px-2 text-sm focus:border-[var(--color-brand-400)] focus:outline-none"
                  >
                    <option value="">— เลือก —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">เหตุผลที่ไม่มีใบเสร็จ *</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-400)] focus:outline-none"
                  placeholder="เช่น ค่ารถแท็กซี่ ผู้ขายออกใบเสร็จไม่ได้"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              บันทึกค่าใช้จ่าย
            </button>
          </div>
        </div>
      )}
    </>
  );
}
