"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Percent, TrendingUp, Moon } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface Props {
  initial: {
    defaultDeadline: string;
    reconcileMode: "binary" | "tolerance";
    reconcileTolerancePercent: number;
    spikeMultiplier: number;
    offHoursStart: string;
    offHoursEnd: string;
  };
}

export function CashHubConfigForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [defaultDeadline, setDefaultDeadline] = useState(initial.defaultDeadline);
  const [reconcileMode, setReconcileMode] = useState(initial.reconcileMode);
  const [tolerance, setTolerance] = useState(
    String(initial.reconcileTolerancePercent),
  );
  const [spike, setSpike] = useState(String(initial.spikeMultiplier));
  const [offStart, setOffStart] = useState(initial.offHoursStart);
  const [offEnd, setOffEnd] = useState(initial.offHoursEnd);

  function save() {
    startTransition(async () => {
      const res = await fetch("/api/admin/settings/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            defaultDeadline,
            reconcileMode,
            reconcileTolerancePercent: Number(tolerance) || 0,
            spikeMultiplier: Number(spike) || 1.5,
            offHoursStart: offStart,
            offHoursEnd: offEnd,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกการตั้งค่า CashHub แล้ว");
      router.refresh();
    });
  }

  return (
    <Card className="animate-fade-up delay-200">
      <CardHeader>
        <CardTitle>ตั้งค่า CashHub</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <Field
          label="Deadline ส่งรายงานเริ่มต้น"
          required
          hint="แต่ละสาขาตั้งของตัวเองได้ที่หน้าสาขา"
        >
          <Input
            type="time"
            value={defaultDeadline}
            onChange={(e) => setDefaultDeadline(e.target.value)}
            prefixSlot={<Clock className="size-4" />}
          />
        </Field>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Reconcile Mode <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(
              [
                {
                  value: "binary",
                  label: "Binary (เคร่ง)",
                  desc: "ยอดต้องตรง 100% ถึงจะ submit ได้",
                },
                {
                  value: "tolerance",
                  label: "Tolerance (ผ่อนปรน)",
                  desc: "ยอมรับความคลาด N%",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex flex-col gap-1 p-3 rounded-xl border-2 cursor-pointer transition-colors",
                  reconcileMode === opt.value
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                    : "border-zinc-200 hover:bg-zinc-50",
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="reconcileMode"
                    checked={reconcileMode === opt.value}
                    onChange={() => setReconcileMode(opt.value)}
                  />
                  <span className="font-semibold text-sm">{opt.label}</span>
                </div>
                <span className="text-xs text-zinc-500">{opt.desc}</span>
              </label>
            ))}
          </div>
        </div>

        {reconcileMode === "tolerance" && (
          <Field label="Tolerance (%)" hint="ตั้ง 1 หมายถึงยอมคลาดได้ 1%">
            <Input
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              prefixSlot={<Percent className="size-4" />}
            />
          </Field>
        )}

        <Field
          label="Spike Multiplier"
          required
          hint="ยอดสูงผิดปกติเมื่อเกินค่าเฉลี่ย 30 วัน × ค่านี้ (เช่น 1.5 = ยอด 150%)"
        >
          <Input
            type="number"
            min={1}
            max={10}
            step={0.1}
            value={spike}
            onChange={(e) => setSpike(e.target.value)}
            prefixSlot={<TrendingUp className="size-4" />}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Off-hours Start" hint="แจ้งเตือนกรอกช่วงผิดเวลา">
            <Input
              type="time"
              value={offStart}
              onChange={(e) => setOffStart(e.target.value)}
              prefixSlot={<Moon className="size-4" />}
            />
          </Field>
          <Field label="Off-hours End">
            <Input
              type="time"
              value={offEnd}
              onChange={(e) => setOffEnd(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={save} loading={pending}>
            บันทึกการตั้งค่า
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
