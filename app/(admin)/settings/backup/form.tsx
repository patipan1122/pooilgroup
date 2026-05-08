"use client";

// Backup config form + manual trigger + history table.
// PATCH /api/admin/settings/backup · POST /api/admin/backup

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, HardDrive, Database, PlayCircle, Archive } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

export type BackupDestination = "cloudflare_r2" | "supabase_storage";

export interface BackupConfig {
  autoDailyAt: string;
  retentionDays: number;
  destination: BackupDestination;
}

export interface BackupHistoryRow {
  id: string;
  createdAt: string;
  triggeredBy: string;
  kind: "manual" | "auto";
}

interface Props {
  initial: BackupConfig;
  history: BackupHistoryRow[];
}

const DEST_OPTIONS: {
  value: BackupDestination;
  label: string;
  hint: string;
}[] = [
  {
    value: "cloudflare_r2",
    label: "Cloudflare R2",
    hint: "แนะนำ — ฟรี 10GB · ไม่มีค่า egress",
  },
  {
    value: "supabase_storage",
    label: "Supabase Storage",
    hint: "ใช้ Bucket เดียวกับไฟล์ในระบบ",
  },
];

export function BackupForm({ initial, history }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [triggering, setTriggering] = useState(false);

  const [autoAt, setAutoAt] = useState(initial.autoDailyAt);
  const [retention, setRetention] = useState(String(initial.retentionDays));
  const [destination, setDestination] = useState<BackupDestination>(
    initial.destination,
  );

  function save() {
    const retentionNum = Number(retention);
    if (!Number.isFinite(retentionNum) || retentionNum < 1 || retentionNum > 365) {
      toast.error("Retention ต้องอยู่ระหว่าง 1–365 วัน");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/settings/backup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoDailyAt: autoAt,
          retentionDays: retentionNum,
          destination,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกค่าสำรองข้อมูลแล้ว");
      router.refresh();
    });
  }

  async function triggerNow() {
    setTriggering(true);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        toast.error(json.error || "เริ่ม Backup ไม่สำเร็จ");
        return;
      }
      toast.success(json.message || "เริ่ม Backup แล้ว");
      router.refresh();
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Schedule + retention */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>ตารางเวลา + เก็บกี่วัน</CardTitle>
          <Badge tone="brand">Auto Daily</Badge>
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Auto Daily Backup"
            required
            hint="เวลารันอัตโนมัติทุกคืน · ค่าเริ่มต้น 03:00"
          >
            <Input
              type="time"
              value={autoAt}
              onChange={(e) => setAutoAt(e.target.value)}
              prefixSlot={<Clock className="size-4" />}
            />
          </Field>
          <Field
            label="Retention"
            required
            hint="เก็บ Backup ย้อนหลังกี่วัน · ค่าเริ่มต้น 30 วัน"
          >
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={retention}
              onChange={(e) => setRetention(e.target.value.replace(/\D/g, ""))}
              placeholder="เช่น 30"
              prefixSlot={<Archive className="size-4" />}
              suffixSlot={<span className="text-sm">วัน</span>}
            />
          </Field>
        </CardBody>
      </Card>

      {/* Destination */}
      <Card className="animate-fade-up delay-75">
        <CardHeader>
          <CardTitle>ปลายทาง</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {DEST_OPTIONS.map((opt) => {
            const active = destination === opt.value;
            const Icon = opt.value === "cloudflare_r2" ? HardDrive : Database;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDestination(opt.value)}
                className={cn(
                  "w-full text-left flex items-start gap-3 rounded-xl border-2 p-3 transition-colors",
                  active
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                    : "border-zinc-200 hover:border-zinc-300 bg-white",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 size-4 rounded-full border-2 shrink-0",
                    active
                      ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)]"
                      : "border-zinc-300",
                  )}
                />
                <div className="size-9 rounded-lg bg-white border border-zinc-200 flex items-center justify-center text-[var(--color-brand-700)] shrink-0">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-zinc-900">
                    {opt.label}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">{opt.hint}</div>
                </div>
              </button>
            );
          })}
        </CardBody>
      </Card>

      {/* Manual backup */}
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>สำรองข้อมูลตอนนี้</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-sm text-zinc-600 max-w-md">
            กดปุ่มเพื่อ Backup ทันที — ใช้เวลาประมาณ 1–3 นาที ระบบจะแจ้งเตือนเมื่อเสร็จ
          </p>
          <Button
            variant="outline"
            onClick={triggerNow}
            loading={triggering}
            disabled={triggering}
          >
            <PlayCircle className="size-4" />
            สำรองตอนนี้
          </Button>
        </CardBody>
      </Card>

      {/* History */}
      <Card className="animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>ประวัติ Backup ล่าสุด</CardTitle>
          <Badge tone="neutral">{history.length} รายการ</Badge>
        </CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <EmptyState
              icon={<Archive className="size-6" />}
              title="ยังไม่มีประวัติ Backup"
              description="เมื่อมี Backup ครั้งแรก รายการจะแสดงที่นี่"
            />
          ) : (
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs uppercase tracking-wider">
                    <th className="px-5 py-2 font-semibold">วัน-เวลา</th>
                    <th className="px-5 py-2 font-semibold">ผู้สั่ง</th>
                    <th className="px-5 py-2 font-semibold">ประเภท</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-2.5 tabular-nums text-zinc-900">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-5 py-2.5 text-zinc-700">
                        {row.triggeredBy}
                      </td>
                      <td className="px-5 py-2.5">
                        {row.kind === "manual" ? (
                          <Badge tone="brand">สั่งเอง</Badge>
                        ) : (
                          <Badge tone="neutral">อัตโนมัติ</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Sticky save */}
      <div className="sticky bottom-4 z-10 mt-6">
        <div className="rounded-2xl border-2 border-zinc-200 bg-white/95 backdrop-blur shadow-pop p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">บันทึกการแก้ไขใน Audit Log</p>
          <Button onClick={save} loading={pending}>
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
    const time = d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}
