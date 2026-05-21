"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/chairops/ui/button";
import { Input } from "@/components/chairops/ui/input";
import { updatePart } from "../actions";

interface Props {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  unitPrice: number | null;
  reorderLevel: number;
  notes: string | null;
}

export function PartEditForm(props: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const r = await updatePart(fd);
          if (r.ok) toast.success("บันทึกแล้ว");
          else toast.error(r.error);
        })
      }
      className="space-y-3"
    >
      <input type="hidden" name="id" value={props.id} />
      <div>
        <label className="text-sm font-medium">ชื่อ</label>
        <Input name="name" defaultValue={props.name} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">หมวด</label>
          <Input name="category" defaultValue={props.category ?? ""} />
        </div>
        <div>
          <label className="text-sm font-medium">หน่วย</label>
          <Input name="unit" defaultValue={props.unit} required />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">จุดสั่งซื้อ</label>
          <Input
            name="reorderLevel"
            type="number"
            min={0}
            defaultValue={props.reorderLevel}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">ราคา/หน่วย</label>
          <Input
            name="unitPrice"
            type="number"
            min={0}
            defaultValue={props.unitPrice ?? ""}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">หมายเหตุ</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={props.notes ?? ""}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
      </div>
    </form>
  );
}
