"use client";

// ขอสิทธิ์เข้าถึงสาขา (CEO 2026-09-13) — พนักงานที่เห็นบิลนี้ได้แต่ scope สาขาไม่ครอบคลุม
// (actorCanReachBranch = false) เห็นแถบเตือนนี้ทันทีที่เปิดหน้า พร้อมปุ่มขอสิทธิ์ตรงนี้เลย
// (เดิมต้องพิมพ์คำสั่งไลน์ "/สาขา <ชื่อ>" เท่านั้น — ผลลัพธ์เดียวกัน แค่เพิ่มทางกดจากหน้าเว็บ).
// เก็บคำขอได้ทีละ 1 คนต่อครั้ง (pendingBranchId) — ขอซ้ำจะทับคำขอเดิม จึงเตือนไว้ถ้ามีค้างอยู่.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { requestLedgerBranchAccess } from "@/app/(admin)/ledger/_actions";
import type { BranchOption } from "@/components/ledger/_kit/types";

export function BranchAccessBanner({
  deniedBranchName,
  pendingBranchName,
  defaultBranchId,
  branches,
}: {
  /** ชื่อสาขาที่บิลนี้ผูกอยู่ แต่ actor ไม่มีสิทธิ์ (สำหรับข้อความเตือน). */
  deniedBranchName: string;
  /** มีคำขอค้างอนุมัติอยู่แล้วไหม — มี = โชว์ชื่อสาขาที่ขอไว้แทนปุ่ม (กันขอซ้ำทับเงียบๆ). */
  pendingBranchName: string | null;
  /** สาขาที่ควร preselect ในตัวเลือก (สาขาของบิลนี้เอง) — ไม่บังคับเลือกอันนี้ก็ได้. */
  defaultBranchId: string | null;
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function submit() {
    if (!branchId) {
      setErr("เลือกสาขาก่อน");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await requestLedgerBranchAccess(branchId);
      if (res.ok) {
        setSent(true);
        setOpen(false);
        router.refresh();
      } else {
        setErr(res.error ?? "ส่งคำขอไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="mb-3 animate-fade-in rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        ไม่มีสิทธิ์ในสาขานี้
      </div>
      <p className="mt-1 text-xs text-rose-700">
        คุณเปิดดูใบนี้ได้ แต่แก้ไข/ยืนยัน/ขอโอนไม่ได้ จนกว่าแอดมินจะอนุมัติสิทธิ์สาขา &ldquo;{deniedBranchName}&rdquo; ให้
      </p>

      {sent || pendingBranchName ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <Check className="size-3.5 shrink-0" aria-hidden />
          ส่งคำขอสิทธิ์สาขา &ldquo;{pendingBranchName ?? deniedBranchName}&rdquo; แล้ว · รอแอดมินอนุมัติ
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="press mt-2.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-rose-700"
        >
          ขอสิทธิ์เข้าถึงสาขานี้
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => { if (!pending) setOpen(false); }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="ขอสิทธิ์เข้าถึงสาขา"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900">ขอสิทธิ์เข้าถึงสาขา</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                aria-label="ปิด"
                className="grid size-8 place-items-center rounded-lg text-zinc-400 active:bg-zinc-100 disabled:opacity-50"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <p className="mb-3 text-xs text-zinc-500">เลือกสาขาที่ต้องการขอสิทธิ์ · แอดมินจะเห็นคำขอนี้ในหน้าตั้งค่า</p>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base text-zinc-900 focus:border-rose-400 focus:outline-none"
            >
              <option value="" disabled>
                — เลือกสาขา —
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={pending || !branchId}
              className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white active:bg-rose-700 disabled:bg-zinc-300"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? "กำลังส่งคำขอ…" : "ส่งคำขอสิทธิ์"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
