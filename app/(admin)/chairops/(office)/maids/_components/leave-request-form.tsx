"use client";

// Admin "บันทึกวันลา" form. Single-shot: maidId + startDate + days + reason.
// Calls createDayOff() server action. Days = 1-31 → server loops INSERT.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createDayOff } from "../actions";

function todayYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export function LeaveRequestForm({ maidId }: { maidId: string }) {
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState(1);
  const [startDate, setStartDate] = useState(todayYmd());
  const [reason, setReason] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createDayOff(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`บันทึกลาเรียบร้อย · ${res.data?.count ?? 0} วัน`);
      setReason("");
      setDays(1);
      setStartDate(todayYmd());
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="maidId" value={maidId} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="mb-1 block text-zinc-600">วันที่เริ่ม</span>
          <input
            name="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-zinc-600">จำนวนวัน</span>
          <input
            name="days"
            type="number"
            min={1}
            max={31}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-1 block text-zinc-600">เหตุผล (ไม่บังคับ)</span>
        <input
          name="reason"
          type="text"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น ลากิจ · ป่วย · ลาคลอด"
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "กำลังบันทึก..." : `บันทึกลา ${days} วัน`}
      </button>
    </form>
  );
}
