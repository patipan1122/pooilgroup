"use client";

// ออกบิลงวดปัจจุบันจากหน้าห้อง + โชว์สถานะบิลงวดนี้ (ตามที่ CEO ขอ: กดออกบิลจากหน้าห้องได้ + เห็นสถานะ)
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { actCreateBill } from "../../_actions";
import { BILL_STATUS } from "@/lib/rentspace/format";

export function UnitBillAction({
  contractId,
  period,
  periodLabelText,
  currentBillId,
  currentBillStatus,
}: {
  contractId: string | null;
  period: string;
  periodLabelText: string;
  currentBillId: string | null;
  currentBillStatus: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function issue() {
    if (!contractId) return;
    start(async () => {
      try {
        const r = await actCreateBill(contractId, period, true);
        toast.success(r.created ? "ออกบิลงวดนี้แล้ว" : "มีบิลของงวดนี้อยู่แล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ออกบิลไม่สำเร็จ");
      }
    });
  }

  const st = currentBillStatus ? BILL_STATUS[currentBillStatus] : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-[13px]">
        <span style={{ color: "var(--rs-text-3)" }}>บิลงวด {periodLabelText}:</span>
        {currentBillId ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold"
            style={{ background: st?.soft ?? "var(--rs-bg-3)", color: st?.color ?? "var(--rs-text-2)" }}
          >
            {st?.label ?? currentBillStatus}
          </span>
        ) : (
          <span className="font-semibold" style={{ color: "var(--rs-pending)" }}>
            ยังไม่ออกบิล
          </span>
        )}
      </div>

      {currentBillId ? (
        <Link
          href={`/rentspace/bills/${currentBillId}`}
          className="rs-btn rs-btn-ghost min-h-[40px] sm:min-h-0"
        >
          <Receipt className="h-4 w-4" /> ดูบิลงวดนี้
        </Link>
      ) : contractId ? (
        <button className="rs-btn min-h-[40px] sm:min-h-0" onClick={issue} disabled={pending}>
          <Receipt className="h-4 w-4" /> {pending ? "กำลังออกบิล…" : `ออกบิลงวด ${periodLabelText}`}
        </button>
      ) : (
        <span className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
          ยังไม่มีสัญญาที่ออกบิลได้
        </span>
      )}
    </div>
  );
}
