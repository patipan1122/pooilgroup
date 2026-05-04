"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Edit3, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function BranchDetailActions({
  branchId,
  isActive,
}: {
  branchId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmClose, setConfirmClose] = useState(false);

  function deactivate() {
    setConfirmClose(false);
    startTransition(async () => {
      const res = await fetch(`/api/admin/branches/${branchId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "ปิดสาขาไม่สำเร็จ");
        return;
      }
      toast.success("ปิดสาขาแล้ว");
      router.refresh();
    });
  }

  function reactivate() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/branches/${branchId}/reactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "เปิดสาขาไม่สำเร็จ");
        return;
      }
      toast.success("เปิดสาขาแล้ว");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isActive ? (
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() => setConfirmClose(true)}
              disabled={pending}
            >
              <X className="size-4" />
              ปิดสาขา
            </Button>
            <a href={`/branches/${branchId}/edit`} className="contents">
              <Button size="md" disabled={pending}>
                <Edit3 className="size-4" />
                แก้ไข
              </Button>
            </a>
          </>
        ) : (
          <Button
            variant="outline"
            size="md"
            onClick={reactivate}
            loading={pending}
          >
            <RotateCcw className="size-4" />
            เปิดสาขาอีกครั้ง
          </Button>
        )}
      </div>

      {confirmClose && (
        <Dialog open onClose={() => setConfirmClose(false)} title="ปิดสาขานี้?">
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">
              สาขาจะถูกซ่อนจากรายการใช้งานทั่วไป · รายงานเก่ายังคงอยู่ ·
              พนักงานที่ผูกอยู่จะยังเข้าหน้าสาขาได้แต่ submit รายงานใหม่ไม่ได้
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" fullWidth onClick={() => setConfirmClose(false)}>
                ยกเลิก
              </Button>
              <Button
                variant="danger"
                fullWidth
                onClick={deactivate}
                loading={pending}
              >
                ยืนยันปิด
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
