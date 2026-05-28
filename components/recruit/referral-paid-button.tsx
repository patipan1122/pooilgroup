"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { markReferralPaid } from "@/lib/recruit/referral-actions";
import { DollarSign } from "lucide-react";

export function ReferralPaidButton({ referralId }: { referralId: string }) {
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!confirm("ยืนยันจ่ายโบนัสแล้ว?")) return;
    startTransition(async () => {
      try {
        await markReferralPaid(referralId);
        toast.success("บันทึกว่าจ่ายโบนัสแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={submit}
      disabled={isPending}
      className="h-9 px-3 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700 inline-flex items-center gap-1 shrink-0"
    >
      <DollarSign className="size-3" />
      {isPending ? "กำลังบันทึก..." : "จ่ายโบนัส"}
    </button>
  );
}
