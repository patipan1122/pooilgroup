"use client";

// Commit / cancel buttons — client component so we can show toast + confirm dialog.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { commitImport, cancelImport } from "../../actions";
import { Button } from "@/components/chairops/ui/button";

export function CommitButtons({
  importId,
  disabled,
  ceoOnlyBlocker,
}: {
  importId: string;
  disabled?: boolean;
  ceoOnlyBlocker?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isCancelling, startCancel] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function onCommit() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    startTransition(async () => {
      const res = await commitImport(importId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("commit สำเร็จ · กลับหน้ารายการ");
      router.push(`/chairops/pos-ingest?committed=${importId}`);
    });
  }

  function onCancel() {
    startCancel(async () => {
      await cancelImport(importId);
      // server action redirects
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={onCancel}
        disabled={isCancelling || isPending}
      >
        {isCancelling ? "กำลังยกเลิก..." : "ยกเลิก import นี้"}
      </Button>
      <Button
        variant={confirm ? "success" : "default"}
        size="lg"
        type="button"
        onClick={onCommit}
        disabled={disabled || isPending || isCancelling}
        title={ceoOnlyBlocker ? "ต้องให้ CEO หรือ ADMIN commit เท่านั้น (มีแก้ไขย้อนหลัง > 1 วัน)" : undefined}
      >
        {isPending ? "กำลัง commit..." : confirm ? "✓ กดอีกครั้งเพื่อยืนยัน" : "ยืนยัน commit"}
      </Button>
    </div>
  );
}
