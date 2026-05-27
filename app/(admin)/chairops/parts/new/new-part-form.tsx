"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPart } from "../actions";

export function NewPartForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const r = await createPart(fd);
          if (r.ok) {
            toast.success("เพิ่มอะไหล่เรียบร้อย");
            router.push(`/chairops/parts/${r.data!.id}`);
          } else {
            toast.error(r.error);
          }
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">รหัสอะไหล่ *</label>
          <Input name="partCode" required placeholder="เช่น MOTOR-G031" />
        </div>
        <div>
          <label className="text-sm font-medium">หน่วย *</label>
          <Input name="unit" required defaultValue="ชิ้น" />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">ชื่อ *</label>
        <Input name="name" required placeholder="เช่น มอเตอร์ G031" />
      </div>

      <div>
        <label className="text-sm font-medium">หมวด</label>
        <Input name="category" placeholder="เช่น มอเตอร์, เบาะ, รีโมท" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-sm font-medium">สต็อกเริ่มต้น</label>
          <Input name="stockOnHand" type="number" min={0} defaultValue={0} />
        </div>
        <div>
          <label className="text-sm font-medium">จุดสั่งซื้อ</label>
          <Input name="reorderLevel" type="number" min={0} defaultValue={0} />
        </div>
        <div>
          <label className="text-sm font-medium">ราคา/หน่วย (บาท)</label>
          <Input name="unitPrice" type="number" min={0} placeholder="ไม่บังคับ" />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">หมายเหตุ</label>
        <textarea
          name="notes"
          rows={2}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "กำลังบันทึก..." : "เพิ่มอะไหล่"}
        </Button>
      </div>
    </form>
  );
}
