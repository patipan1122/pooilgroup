"use client";

import { useState, useTransition } from "react";
import { actUpdateBookingStatus } from "../../_actions";

const OPTIONS = [
  { v: "pending",    label: "รออนุมัติ" },
  { v: "confirmed",  label: "ยืนยัน" },
  { v: "checked_in", label: "เข้าพัก" },
  { v: "completed",  label: "เสร็จสิ้น" },
  { v: "cancelled",  label: "ยกเลิก" },
  { v: "no_show",    label: "ไม่มา" },
] as const;

export function BookingStatusSelect({ id, current }: { id: string; current: string }) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(current);

  return (
    <select
      disabled={pending}
      value={status}
      onChange={(e) => {
        const next = e.target.value as typeof OPTIONS[number]["v"];
        setStatus(next);
        start(async () => {
          try {
            await actUpdateBookingStatus(id, next);
          } catch {
            setStatus(current);
          }
        });
      }}
      className="text-xs px-2 py-1 rounded-lg ring-1 ring-zinc-200 bg-white focus:ring-2 focus:ring-zinc-900 outline-none"
    >
      {OPTIONS.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  );
}
