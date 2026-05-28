"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAccount } from "./actions";

export function NewAccountForm({ branches }: { branches: { id: string; name: string }[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={ref}
      action={(fd) =>
        startTransition(async () => {
          const r = await createAccount(fd);
          if (r.ok) {
            toast.success("เพิ่มบัญชีเรียบร้อย");
            ref.current?.reset();
          } else {
            toast.error(r.error);
          }
        })
      }
      className="space-y-3"
    >
      <div>
        <label className="text-sm font-medium">ธนาคาร *</label>
        <Input name="bankName" required placeholder="เช่น กสิกรไทย" />
      </div>
      <div>
        <label className="text-sm font-medium">เลขบัญชี *</label>
        <Input name="accountNo" required placeholder="xxx-x-xxxxx-x" />
      </div>
      <div>
        <label className="text-sm font-medium">ชื่อบัญชี *</label>
        <Input name="accountName" required />
      </div>
      <div>
        <label className="text-sm font-medium">สาขาที่ใช้ (ไม่บังคับ)</label>
        <select
          name="branchId"
          className="h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          <option value="">— ทุกสาขา —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium">หมายเหตุ</label>
        <textarea
          name="notes"
          rows={2}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "กำลังบันทึก..." : "เพิ่มบัญชี"}
      </Button>
    </form>
  );
}
