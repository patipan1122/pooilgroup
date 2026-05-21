"use client";

// Right-to-erasure form — collapsible card on /my/[refId]
// Candidate can submit request to delete their data (PDPA right)

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { submitErasureRequest } from "./erasure-action";
import { Trash2, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

interface Props {
  refId: string;
  hasPendingRequest?: boolean;
}

export function ErasureForm({ refId, hasPendingRequest }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(hasPendingRequest ?? false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!confirm("ยืนยันส่งคำขอลบข้อมูล? · ทาง HR จะติดต่อกลับเพื่อยืนยัน")) return;
    startTransition(async () => {
      const result = await submitErasureRequest({ refId, reason: reason.trim() });
      if (result.ok) {
        setSubmitted(true);
        toast.success("ส่งคำขอลบข้อมูลเรียบร้อย · HR จะติดต่อกลับ");
      } else {
        toast.error(result.error);
      }
    });
  }

  if (submitted) {
    return (
      <div className="px-4 mt-6">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex items-start gap-3">
          <CheckCircle2 className="size-5 text-green-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-green-900">ส่งคำขอลบข้อมูลแล้ว</p>
            <p className="text-xs text-green-800 mt-1 leading-relaxed">
              HR จะพิจารณาและติดต่อกลับใน 30 วัน ตาม PDPA
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 mt-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50"
      >
        <span className="size-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
          <Trash2 className="size-4" />
        </span>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold text-zinc-900">ขอลบข้อมูลส่วนตัว (PDPA)</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            แจ้ง HR ให้ลบข้อมูลของคุณออกจากระบบ
          </p>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-zinc-400" />
        ) : (
          <ChevronDown className="size-4 text-zinc-400" />
        )}
      </button>

      {open && (
        <div className="mt-3 p-4 rounded-2xl border border-red-200 bg-red-50/40">
          <p className="text-xs text-zinc-700 leading-relaxed mb-3">
            ตามกฎหมาย PDPA คุณมีสิทธิ์ขอลบข้อมูลส่วนตัวออกจากระบบของเรา · HR จะพิจารณา
            ตามกฎหมายและติดต่อกลับเพื่อยืนยันภายใน 30 วัน · ถ้าอนุมัติ ข้อมูลทั้งหมด
            (ใบสมัคร · ไฟล์แนบ · timeline) จะถูกลบถาวร
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เหตุผล (ไม่จำเป็น): เช่น 'ไม่อยากให้เก็บข้อมูลแล้ว' · 'จะไปทำงานที่อื่น'"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            rows={3}
            maxLength={500}
          />
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="h-9 px-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
            >
              {isPending ? "กำลังส่ง..." : "ส่งคำขอลบข้อมูล"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
