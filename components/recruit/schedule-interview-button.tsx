"use client";

// Schedule Interview button + modal dialog
// Embedded in ApplicationActions or any context where HR wants to schedule

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { scheduleInterview } from "@/lib/recruit/interview-actions";
import { CalendarCheck, X } from "lucide-react";

interface Props {
  applicationId: string;
}

export function ScheduleInterviewButton({ applicationId }: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState<"ONSITE" | "PHONE" | "VIDEO">("ONSITE");
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!date || !time) {
      toast.error("กรอกวันและเวลา");
      return;
    }
    const scheduledAt = `${date}T${time}:00`;
    startTransition(async () => {
      try {
        await scheduleInterview({
          applicationId,
          scheduledAt,
          kind,
          location: kind === "ONSITE" ? location : kind === "VIDEO" ? location : undefined,
          durationMin: duration,
          notes,
        });
        toast.success("นัดสัมภาษณ์เรียบร้อย · บันทึก Timeline + Calendar แล้ว");
        setOpen(false);
        setDate("");
        setTime("");
        setLocation("");
        setNotes("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs h-9 px-3 rounded-lg bg-orange-100 text-orange-800 hover:bg-orange-200 font-bold"
      >
        <CalendarCheck className="size-3.5" />
        นัดสัมภาษณ์
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-zinc-900/60 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-extrabold font-display text-zinc-900">
                นัดสัมภาษณ์
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="size-8 rounded-lg hover:bg-zinc-100 grid place-items-center"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                    วันที่ *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                    เวลา *
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  ประเภท
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { value: "ONSITE", label: "📍 ที่สถานที่" },
                    { value: "PHONE", label: "📞 โทรศัพท์" },
                    { value: "VIDEO", label: "💻 วิดีโอ" },
                  ].map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => setKind(k.value as "ONSITE" | "PHONE" | "VIDEO")}
                      className={`h-11 text-xs font-bold rounded-xl border-2 ${
                        kind === k.value
                          ? "border-orange-500 bg-orange-50 text-orange-800"
                          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>

              {kind !== "PHONE" && (
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                    {kind === "ONSITE" ? "สถานที่" : "ลิ้งค์ Zoom/Meet"}
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={
                      kind === "ONSITE"
                        ? "เช่น สาขาทองคำ ห้อง 2"
                        : "เช่น https://meet.google.com/..."
                    }
                    className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  ระยะเวลา (นาที)
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300"
                >
                  <option value={30}>30 นาที</option>
                  <option value={60}>1 ชั่วโมง</option>
                  <option value={90}>1 ชั่วโมง 30 นาที</option>
                  <option value={120}>2 ชั่วโมง</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  หมายเหตุ
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="เช่น 'นำเอกสารบัตรประชาชน + ปริญญาบัตรมาด้วย'"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                  rows={3}
                />
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-zinc-700 leading-relaxed">
                💡 หลังบันทึก ระบบจะ:
                <br />· เพิ่ม entry ใน <b>Calendar</b> ของ HR
                <br />· เพิ่ม timeline ในใบสมัคร (ผู้สมัครเห็นใน /my)
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-10 px-4 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={isPending || !date || !time}
                  className="h-10 px-5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50"
                >
                  {isPending ? "กำลังบันทึก..." : "บันทึกนัดสัมภาษณ์"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
