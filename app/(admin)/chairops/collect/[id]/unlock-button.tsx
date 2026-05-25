"use client";

// Tiny client wrapper around the requestUnlock server action.
// Visible only for OFFICE+ (parent page gates on canUnlockCollection).
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/chairops/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Unlock, Loader2 } from "lucide-react";
import { requestUnlock } from "../actions";

export function UnlockButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function onConfirmed() {
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await requestUnlock(id);
        if (!res.ok) {
          toast.error(res.error);
          resolve();
          return;
        }
        toast.success("ปลดล็อกแล้ว");
        router.refresh();
        resolve();
      });
    });
  }

  return (
    <ConfirmDialog
      trigger={
        <Button disabled={pending} variant="warning" size="lg" className="w-full">
          {pending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังปลดล็อก...
            </>
          ) : (
            <>
              <Unlock className="mr-2 h-5 w-5" /> ปลดล็อก (สำหรับออฟฟิศ)
            </>
          )}
        </Button>
      }
      title="ยืนยันการปลดล็อก"
      body="ปลดล็อกรายการนี้เพื่อให้แม่บ้านแก้ไขได้ · ระบบจะ log audit"
      confirmLabel="ปลดล็อก"
      cancelLabel="ยกเลิก"
      variant="primary"
      onConfirm={onConfirmed}
    />
  );
}
