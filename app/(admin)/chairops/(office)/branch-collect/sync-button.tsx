"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { syncChairsFromPos } from "@/app/(admin)/chairops/branches/actions";

export function SyncChairsFromPosButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (pending) return;
    startTransition(async () => {
      const res = await syncChairsFromPos();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { branchesScanned, chairsInserted, chairsAlreadyExisting } = res.data;
      if (chairsInserted === 0) {
        toast.info(
          `สแกน ${branchesScanned} สาขา · มีเก้าอี้อยู่แล้ว ${chairsAlreadyExisting} ตัว · ไม่มีเก้าอี้ใหม่ใน POS`,
        );
      } else {
        toast.success(
          `เพิ่ม ${chairsInserted} เก้าอี้ใน ${branchesScanned} สาขา (มีอยู่แล้ว ${chairsAlreadyExisting})`,
        );
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-3.5" aria-hidden />
      )}
      ดึงเก้าอี้จาก POS อัตโนมัติ
    </button>
  );
}
