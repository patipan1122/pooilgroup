"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/chairops/ui/button";
import { Input } from "@/components/chairops/ui/input";
import { adjustStock } from "../actions";

export function AdjustStockForm({
  partId,
  currentStock,
}: {
  partId: string;
  currentStock: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [delta, setDelta] = useState("");

  const numericDelta = parseInt(delta, 10) || 0;
  const projected = currentStock + numericDelta;

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const r = await adjustStock(fd);
          if (r.ok) {
            toast.success("ปรับสต็อกแล้ว");
            setDelta("");
          } else {
            toast.error(r.error);
          }
        })
      }
      className="space-y-3"
    >
      <input type="hidden" name="partId" value={partId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">
            จำนวน (+ เพิ่ม / − ลด)
          </label>
          <Input
            name="delta"
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="เช่น 10 หรือ -5"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">สต็อกหลังปรับ</label>
          <div className="flex h-12 items-center rounded-md border border-border bg-muted/40 px-3 text-sm font-semibold">
            {projected.toLocaleString("en-US")}
            {projected < 0 && (
              <span className="ml-2 text-xs text-danger">(ติดลบ ไม่อนุญาต)</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">เหตุผล *</label>
        <Input
          name="reason"
          required
          placeholder="เช่น รับเข้าจาก supplier · นับสต็อก · เสียหาย"
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || numericDelta === 0 || projected < 0}>
          {isPending ? "กำลังบันทึก..." : "ปรับสต็อก"}
        </Button>
      </div>
    </form>
  );
}
