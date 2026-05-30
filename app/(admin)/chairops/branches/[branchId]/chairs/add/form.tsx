"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { addChairsToBranch } from "@/app/(admin)/chairops/branches/actions";

interface Props {
  branchId: string;
}

export function AddChairsForm({ branchId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState("");
  const codesId = useId();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = codes.trim();
    if (!trimmed) {
      toast.error("กรอกรหัสเก้าอี้");
      return;
    }
    startTransition(async () => {
      const res = await addChairsToBranch({ branchId, codesRaw: trimmed });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { inserted, skippedExisting } = res.data;
      if (inserted === 0) {
        toast.info(`ทั้งหมด ${skippedExisting} ตัวมีอยู่แล้ว · ไม่ได้เพิ่มเก้าอี้ใหม่`);
      } else {
        toast.success(
          skippedExisting > 0
            ? `เพิ่ม ${inserted} ตัว · ข้าม ${skippedExisting} ตัวที่มีอยู่`
            : `เพิ่ม ${inserted} ตัวเรียบร้อย`,
        );
        setCodes("");
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardBody className="space-y-3 p-4">
          <label htmlFor={codesId} className="text-sm font-semibold text-zinc-800">
            รหัสเก้าอี้ (1 บรรทัด/รหัส หรือคั่นด้วยจุลภาค)
          </label>
          <textarea
            id={codesId}
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
            rows={8}
            maxLength={8000}
            placeholder={"CH-001\nCH-002\nCH-003\n... (สูงสุด 200 ตัว/ครั้ง)"}
            className="w-full rounded-md border border-zinc-200 bg-white p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
          <p className="text-xs text-zinc-500">
            ระบบ uppercase อัตโนมัติ · กรองช่องว่าง · ข้ามรหัสที่มีอยู่แล้ว
            (idempotent ทำซ้ำได้ปลอดภัย)
          </p>
          <Button
            type="submit"
            size="xl"
            className="h-12 w-full text-base font-semibold"
            disabled={pending || !codes.trim()}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังเพิ่ม...
              </>
            ) : (
              "เพิ่มเก้าอี้"
            )}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
