"use client";

// Approve / reject controls for one onboarding submission.
// Kept deliberately thin: every rule (role, status re-check, race guard,
// duplicate email) lives in ../actions.ts on the server — this component only
// collects the reject reason and shows the outcome.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Check, X, Eye, AlertTriangle } from "lucide-react";
import {
  approveOnboarding,
  rejectOnboarding,
  startOnboardingReview,
} from "../actions";

export function ReviewPanel({
  submissionId,
  candidateName,
  status,
  canDecide,
}: {
  submissionId: string;
  candidateName: string;
  status: "SUBMITTED" | "HR_REVIEWING" | "APPROVED" | "REJECTED";
  canDecide: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");

  if (!canDecide) {
    return (
      <p className="text-xs text-zinc-500">
        บัญชีของคุณดูได้อย่างเดียว · ต้องเป็นแอดมิน Recruit ถึงจะอนุมัติ/ตีกลับได้
      </p>
    );
  }

  const decided = status === "APPROVED" || status === "REJECTED";
  if (decided) {
    return (
      <p className="text-xs text-zinc-500">
        ใบนี้พิจารณาไปแล้ว · เปลี่ยนผลไม่ได้จากหน้านี้ (ถ้าอนุมัติผิดคน ให้ปิดใช้งานบัญชีที่หน้า{" "}
        <span className="font-mono">/users</span> แล้วบันทึกเหตุผลไว้)
      </p>
    );
  }

  function doStartReview() {
    startTransition(async () => {
      const r = await startOnboardingReview(submissionId);
      if (!r.ok) {
        toast.error(r.error ?? "ทำรายการไม่สำเร็จ");
        return;
      }
      toast.success("ทำเครื่องหมายว่ากำลังตรวจแล้ว");
      router.refresh();
    });
  }

  function doApprove() {
    const ok = window.confirm(
      `ยืนยันอนุมัติ "${candidateName}"?\n\n` +
        "• ระบบจะสร้างบัญชีพนักงานจริงทันที (สิทธิ์ staff)\n" +
        "• บัญชียังปิดอยู่ จนกว่าจะไปกดเปิดใช้งานที่หน้าผู้ใช้\n" +
        "• โทรเช็คกับเบอร์ที่คุยตอนสัมภาษณ์แล้วใช่ไหม?",
    );
    if (!ok) return;
    startTransition(async () => {
      const r = await approveOnboarding(submissionId);
      if (!r.ok) {
        toast.error(r.error ?? "อนุมัติไม่สำเร็จ", { duration: 8000 });
        return;
      }
      toast.success("อนุมัติแล้ว · สร้างบัญชีให้เรียบร้อย (ยังไม่เปิดใช้งาน)");
      router.refresh();
    });
  }

  function doReject() {
    if (!reason.trim()) return toast.error("ต้องระบุเหตุผลที่ตีกลับ");
    startTransition(async () => {
      const r = await rejectOnboarding(submissionId, reason);
      if (!r.ok) {
        toast.error(r.error ?? "ตีกลับไม่สำเร็จ", { duration: 8000 });
        return;
      }
      toast.success("ตีกลับแล้ว · บันทึกเหตุผลไว้ในระบบ");
      setMode("idle");
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "SUBMITTED" && (
          <Button variant="outline" size="md" onClick={doStartReview} disabled={isPending}>
            <Eye className="size-4" />
            รับเรื่องมาตรวจ
          </Button>
        )}
        <Button variant="primary" size="md" onClick={doApprove} loading={isPending}>
          <Check className="size-4" />
          อนุมัติ · สร้างบัญชีพนักงาน
        </Button>
        <Button
          variant={mode === "reject" ? "secondary" : "outline"}
          size="md"
          onClick={() => setMode(mode === "reject" ? "idle" : "reject")}
          disabled={isPending}
        >
          <X className="size-4" />
          ตีกลับ / ไม่รับ
        </Button>
      </div>

      {mode === "reject" && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 space-y-2">
          <label
            htmlFor="onboarding-reject-reason"
            className="text-xs font-bold text-red-900 flex items-center gap-1.5"
          >
            <AlertTriangle className="size-3.5" />
            เหตุผลที่ตีกลับ (พนักงานจะได้ยินเหตุผลนี้จากคุณ · บังคับกรอก)
          </label>
          <textarea
            id="onboarding-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="เช่น รูปบัตรประชาชนเบลอ อ่านเลขไม่ออก · ขอถ่ายใหม่ในที่แสงสว่าง"
            className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400"
          />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={doReject} loading={isPending}>
              ยืนยันตีกลับ
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("idle")}
              disabled={isPending}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
