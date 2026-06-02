"use client";

// LIFF self-flag "วันนี้ฉันลา" card. Two states:
//   - Not on leave today  → primary button opens reason input + submit.
//   - On leave today      → secondary "ยกเลิกลาวันนี้" until 18:00 BKK (server
//                            enforces the cutoff; UI is best-effort hint).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Coffee, Loader2 } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  requestOwnDayOff,
  cancelOwnDayOff,
} from "@/app/(admin)/chairops/(office)/maids/actions";

export function SelfDayOffCard({
  onLeaveToday,
  todayReason,
}: {
  onLeaveToday: boolean;
  todayReason: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");

  function submitLeave(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const fd = new FormData();
    if (reason.trim()) fd.set("reason", reason.trim());
    startTransition(async () => {
      const res = await requestOwnDayOff(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("บันทึกลาวันนี้แล้ว · ออฟฟิศได้รับแจ้งแล้ว");
      setExpanded(false);
      setReason("");
    });
  }

  function cancelLeave() {
    if (!window.confirm("ยกเลิกลาวันนี้?")) return;
    startTransition(async () => {
      const res = await cancelOwnDayOff();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ยกเลิกลาเรียบร้อย");
    });
  }

  if (onLeaveToday) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardBody className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Coffee className="size-4" aria-hidden /> วันนี้คุณลา
          </div>
          <p className="text-xs text-amber-800">
            {todayReason ?? "ไม่ระบุเหตุผล"} · กดยกเลิกได้ถึง 18:00 น.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={cancelLeave}
            disabled={pending}
            className="w-full"
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> กำลังยกเลิก...
              </>
            ) : (
              "ยกเลิกลาวันนี้"
            )}
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-zinc-200">
      <CardBody className="space-y-2 p-4">
        {!expanded ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setExpanded(true)}
            className="w-full"
          >
            <Coffee className="mr-2 size-4" aria-hidden /> วันนี้ฉันลา
          </Button>
        ) : (
          <form onSubmit={submitLeave} className="space-y-2">
            <label className="block text-xs">
              <span className="mb-1 block text-zinc-600">เหตุผล (ไม่บังคับ)</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                placeholder="เช่น ป่วย · ลากิจ · ลาคลอด"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                autoFocus
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setExpanded(false);
                  setReason("");
                }}
                className="flex-1"
              >
                ยกเลิก
              </Button>
              <Button
                type="submit"
                disabled={pending}
                size="sm"
                className="flex-1 bg-amber-600 hover:bg-amber-700"
              >
                {pending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> กำลังส่ง...
                  </>
                ) : (
                  "ยืนยันลาวันนี้"
                )}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
