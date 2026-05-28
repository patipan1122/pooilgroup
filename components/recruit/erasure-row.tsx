"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { approveErasure, rejectErasure } from "@/lib/recruit/erasure-actions";
import { Check, X, Clock } from "lucide-react";

interface Request {
  id: string;
  refId: string;
  applicantName: string;
  phone: string;
  email: string | null;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
}

export function ErasureRow({ request }: { request: Request }) {
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<"approve" | "reject" | null>(null);
  const [isPending, startTransition] = useTransition();

  const isPendingRequest = request.status === "PENDING";

  function doApprove() {
    if (
      !confirm(
        "⚠️ ยืนยันลบข้อมูลของผู้สมัครคนนี้?\n\nจะ anonymize ทุกข้อมูล:\n- ชื่อ → '[ลบแล้ว]'\n- เบอร์ + อีเมล\n- ใบสมัครทั้งหมด\n- timeline + messages\n\nกู้คืนไม่ได้",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await approveErasure(request.id, note);
        toast.success("ลบข้อมูลแล้ว · บันทึก audit log ไว้");
        setEditing(null);
        setNote("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function doReject() {
    if (!note.trim()) {
      toast.error("ต้องระบุเหตุผลปฏิเสธ");
      return;
    }
    startTransition(async () => {
      try {
        await rejectErasure(request.id, note);
        toast.success("ปฏิเสธคำขอแล้ว");
        setEditing(null);
        setNote("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const statusPill =
    request.status === "PENDING"
      ? { label: "รอพิจารณา", className: "bg-amber-100 text-amber-800", Icon: Clock }
      : request.status === "COMPLETED"
        ? { label: "ลบแล้ว", className: "bg-green-100 text-green-800", Icon: Check }
        : { label: "ปฏิเสธ", className: "bg-red-100 text-red-800", Icon: X };

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${statusPill.className}`}
            >
              <statusPill.Icon className="size-3" />
              {statusPill.label}
            </span>
            <span className="font-mono text-[11px] text-zinc-500">
              #{request.refId}
            </span>
          </div>
          <p className="font-bold text-zinc-900 mt-1.5">{request.applicantName}</p>
          <p className="text-xs text-zinc-500 font-mono">
            {request.phone} {request.email ? `· ${request.email}` : ""}
          </p>
          {request.reason && (
            <p className="text-xs text-zinc-700 mt-2 pl-3 border-l-2 border-zinc-200 italic">
              &ldquo;{request.reason}&rdquo;
            </p>
          )}
          <p className="text-[11px] text-zinc-400 mt-2">
            ขอเมื่อ {new Date(request.requestedAt).toLocaleString("th-TH")}
            {request.decidedAt && (
              <>
                {" · พิจารณาเมื่อ "}
                {new Date(request.decidedAt).toLocaleString("th-TH")}
                {request.decidedByName && ` โดย ${request.decidedByName}`}
              </>
            )}
          </p>
          {request.decisionNote && (
            <p className="text-xs text-zinc-700 mt-1 pl-3 border-l-2 border-zinc-300">
              <b>หมายเหตุ:</b> {request.decisionNote}
            </p>
          )}
        </div>
        {isPendingRequest && !editing && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setEditing("approve")}
              className="h-9 px-3 inline-flex items-center gap-1 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              <Check className="size-3" />
              ลบข้อมูล
            </button>
            <button
              type="button"
              onClick={() => setEditing("reject")}
              className="h-9 px-3 inline-flex items-center gap-1 text-xs font-bold rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
            >
              <X className="size-3" />
              ปฏิเสธ
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-zinc-200">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              editing === "approve"
                ? "หมายเหตุ (ไม่บังคับ)"
                : "เหตุผลปฏิเสธ * เช่น 'ต้องเก็บข้อมูลตามกฎหมายแรงงาน 2 ปี'"
            }
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
            rows={2}
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setNote("");
              }}
              className="h-9 px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={editing === "approve" ? doApprove : doReject}
              disabled={isPending}
              className={`h-9 px-4 text-xs font-bold text-white rounded-lg disabled:opacity-50 ${
                editing === "approve" ? "bg-red-600 hover:bg-red-700" : "bg-zinc-700 hover:bg-zinc-800"
              }`}
            >
              {isPending
                ? "กำลังบันทึก..."
                : editing === "approve"
                  ? "ยืนยันลบข้อมูล"
                  : "ยืนยันปฏิเสธ"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
