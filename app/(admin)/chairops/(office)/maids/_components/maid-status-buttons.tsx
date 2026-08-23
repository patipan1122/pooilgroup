"use client";

// Resign / reactivate a maid directly from the activity table (CEO 2026-08-23
// follow-up: "อยากให้มันกดจากหน้านี้ได้ด้วย" — same safety gate as the
// existing /chairops/users/[id] deactivate flow (reason + optional note +
// type-name-to-confirm), just reachable without leaving the table.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import type { OffboardingReason } from "@/lib/generated/prisma/enums";
import { deactivateUser, reactivateUser } from "@/app/(admin)/chairops/users/actions";

const OFFBOARDING_LABEL: Record<OffboardingReason, string> = {
  RESIGNED: "ลาออก",
  TERMINATED: "เลิกจ้าง",
  TRANSFERRED: "ย้ายสาขา",
  OTHER: "อื่นๆ",
};

export function ResignMaidButton({ userId, displayName }: { userId: string; displayName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<OffboardingReason>("RESIGNED");
  const [note, setNote] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const res = await deactivateUser(userId, reason, note || undefined);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${displayName} ออกจากระบบแล้ว`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 inline-flex items-center rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-rose-50 hover:text-rose-700"
      >
        ลาออก
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`ให้ ${displayName} ออกจากระบบ`}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">เหตุผล</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as OffboardingReason)}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm focus:outline-none"
            >
              {(Object.keys(OFFBOARDING_LABEL) as OffboardingReason[]).map((r) => (
                <option key={r} value={r}>
                  {OFFBOARDING_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">หมายเหตุ (ไม่บังคับ)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="รายละเอียดเพิ่มเติม..."
              className="w-full resize-none rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">
              พิมพ์ชื่อ <span className="font-bold text-zinc-900">{displayName}</span> เพื่อยืนยัน
            </label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={displayName}
              disabled={pending}
              className="text-sm"
            />
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending || confirmName.trim() !== displayName.trim()}
            loading={pending}
            onClick={submit}
            className="w-full"
          >
            ยืนยันให้ออกจากระบบ
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function ReactivateMaidButton({ userId, displayName }: { userId: string; displayName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const res = await reactivateUser(userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${displayName} กลับมาใช้งานแล้ว`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="ml-2 inline-flex items-center rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
    >
      เปิดใช้งานอีกครั้ง
    </button>
  );
}
