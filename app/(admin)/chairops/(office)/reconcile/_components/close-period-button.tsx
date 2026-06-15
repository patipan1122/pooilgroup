"use client";

// FIN-01 (audit 2026-06-15): ปุ่ม "ปิดงวดเงินขาด" — super_admin only.
// รีเซ็ตฐานการนับ "เงินขาด" จากสะสมตลอดชีพ → เริ่มนับใหม่ตั้งแต่วันนี้ (รายงวด).
// ยอดสะสมเดิมถูก snapshot เก็บใน audit log ก่อน reset (หลักฐาน · ไม่ใช่ลบหนี้).
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarClock, Check } from "lucide-react";
import { closePeriodForOrg } from "@/lib/chairops/reconcile/actions";

export function ClosePeriodButton() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ branchCount: number; snapshotTotal: number } | null>(null);

  function onClick() {
    if (pending) return;
    const ok = window.confirm(
      "ปิดงวดเงินขาด?\n\n" +
        "• ตัวเลข “เงินขาด” จะเริ่มนับใหม่ตั้งแต่วันนี้ (เลิกสะสมตลอดชีพ)\n" +
        "• ยอดสะสมเดิมของทุกสาขาจะถูกบันทึกเก็บเป็นหลักฐานก่อน (ไม่ใช่การลบหนี้)\n" +
        "• ตัวเลขบนแดชบอร์ดจะเปลี่ยน (กระโดด) ทันที\n\n" +
        "ควรทำพร้อมนักบัญชี · ทำต่อหรือไม่?",
    );
    if (!ok) return;
    startTransition(async () => {
      const r = await closePeriodForOrg();
      if (r.ok) {
        setDone({ branchCount: r.branchCount, snapshotTotal: r.snapshotTotal });
        toast.success(`ปิดงวดแล้ว · ${r.branchCount} สาขา · เริ่มนับใหม่`);
      } else {
        toast.error(r.error);
      }
    });
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
        <Check className="size-4 shrink-0" aria-hidden />
        <span>
          ปิดงวดแล้ว {done.branchCount} สาขา · ยอดสะสมเดิมรวม{" "}
          {Math.abs(done.snapshotTotal).toLocaleString("th-TH")} บาท บันทึกเป็นหลักฐานแล้ว ·
          เงินขาดเริ่มนับใหม่
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
      <p className="text-xs text-amber-800">
        ปิดงวดเพื่อให้ตัวเลข “เงินขาด” นับเป็นรายงวด (เลิกสะสมตลอดชีพ) · ควรทำพร้อมนักบัญชี
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        loading={pending}
        disabled={pending}
      >
        <CalendarClock className="mr-1.5 size-4" aria-hidden /> ปิดงวดเงินขาด
      </Button>
    </div>
  );
}
