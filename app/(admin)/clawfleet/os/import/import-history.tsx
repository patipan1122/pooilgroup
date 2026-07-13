"use client";

// ClawFleet · ประวัติการนำเข้า + ปุ่มยกเลิกทั้งชุด (undo)
// รับรายการชุดนำเข้าจาก server (listRecentImportBatches) · กดยกเลิก → undoImportBatch
// ลบ event ทั้งชุด + คืนสถานะมิเตอร์/baseline ให้ตู้.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { undoImportBatch } from "./actions";
import type { ImportBatchSummary } from "./types";

export function ImportHistory({ batches }: { batches: ImportBatchSummary[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function onUndo(batchId: string) {
    startTransition(async () => {
      const res = await undoImportBatch(batchId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`ยกเลิกแล้ว · ลบ ${res.deleted} แถว`);
      setConfirmId(null);
      router.refresh();
    });
  }

  if (batches.length === 0) {
    return <p className="text-sm text-zinc-500">ยังไม่มีการนำเข้า</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="px-2 py-1.5">นำเข้าเมื่อ</th>
            <th className="px-2 py-1.5">ช่วงวันที่</th>
            <th className="px-2 py-1.5 text-right">ตู้</th>
            <th className="px-2 py-1.5 text-right">แถว</th>
            <th className="px-2 py-1.5 text-right">เงินรวม (บาท)</th>
            <th className="px-2 py-1.5 text-right">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.batchId} className="border-t border-zinc-100">
              <td className="px-2 py-1.5 tabular-nums">
                {b.createdAt.slice(0, 16).replace("T", " ")}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-zinc-600">
                {b.firstDay === b.lastDay ? b.firstDay : `${b.firstDay} → ${b.lastDay}`}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{b.machines}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{b.count}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                {b.totalBaht.toLocaleString("en-US")}
              </td>
              <td className="px-2 py-1.5 text-right">
                {confirmId === b.batchId ? (
                  <span className="inline-flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => onUndo(b.batchId)}
                      disabled={isPending}
                    >
                      {isPending ? "กำลังลบ…" : "ยืนยันลบทั้งชุด"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmId(null)}
                      disabled={isPending}
                    >
                      ไม่
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmId(b.batchId)}
                    disabled={isPending}
                  >
                    ยกเลิกทั้งชุด
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
