"use client";

// W3 (claude-design) · CommitCard · 3-checkbox checklist + maker-checker commit.
//
// Spec: plan §W3 — "checklist requirement before commit"
// Per BR16 the action `commitPosImportWithCheck` re-validates everything server-side.
// UI mirrors gates so the button can't even be clicked when blocked.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  commitPosImportWithCheck,
  cancelImport,
} from "@/app/(admin)/chairops/pos-ingest/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type AckKey = "reviewedRows" | "reviewedWarnings" | "acceptResponsibility";

const CHECKLIST: { key: AckKey; label: string }[] = [
  {
    key: "reviewedRows",
    label: "ตรวจแถว 4 กลุ่ม (ใหม่/เหมือนเดิม/เปลี่ยน/ผิด) ครบแล้ว",
  },
  {
    key: "reviewedWarnings",
    label: "อ่านคำเตือน (maker-checker · past-day · แถวผิด) แล้ว",
  },
  {
    key: "acceptResponsibility",
    label: "ยืนยันว่าฉันเป็นผู้ commit (ระบบจะ log ไว้ในประวัติ)",
  },
];

export function CommitCard({
  importId,
  appliedRowCount,
  badRowCount,
  disabled,
  makerCheckerBlocker,
  ceoOnlyBlocker,
}: {
  importId: string;
  appliedRowCount: number;
  badRowCount: number;
  disabled?: boolean;
  makerCheckerBlocker?: boolean;
  ceoOnlyBlocker?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isCancelling, startCancel] = useTransition();
  const [ack, setAck] = useState<Record<AckKey, boolean>>({
    reviewedRows: false,
    reviewedWarnings: false,
    acceptResponsibility: false,
  });

  const allChecked =
    ack.reviewedRows && ack.reviewedWarnings && ack.acceptResponsibility;
  const submitDisabled = disabled || !allChecked || isPending || isCancelling;

  function onCommit() {
    if (!allChecked) {
      toast.error("กรุณายืนยัน checklist ทั้ง 3 ข้อก่อน commit");
      return;
    }
    startTransition(async () => {
      const res = await commitPosImportWithCheck(importId, ack);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("commit สำเร็จ · กลับหน้ารายการ");
      router.push(`/chairops/pos-ingest?committed=${importId}`);
    });
  }

  function onCancelConfirmed() {
    startCancel(async () => {
      await cancelImport(importId);
      // server action redirects
    });
  }

  const blockerTooltip = makerCheckerBlocker
    ? "Maker-Checker block · ต้องให้คนอื่น commit"
    : ceoOnlyBlocker
      ? "ต้องให้ CEO หรือ ADMIN commit (มีแก้ไขย้อนหลัง > 1 วัน)"
      : !allChecked
        ? "กา ✓ checklist ทั้ง 3 ข้อก่อน"
        : undefined;

  return (
    <Card className="mt-6 p-4">
      <h2 className="mb-3 text-base font-semibold">
        ยืนยัน commit · {appliedRowCount.toLocaleString("th-TH")} แถวจะถูกเขียน
        {badRowCount > 0 && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            (ผิด {badRowCount.toLocaleString("th-TH")} แถวจะถูกข้าม)
          </span>
        )}
      </h2>

      <ul className="mb-4 space-y-2">
        {CHECKLIST.map((item) => {
          const checked = ack[item.key];
          return (
            <li key={item.key}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    setAck((prev) => ({
                      ...prev,
                      [item.key]: e.target.checked,
                    }))
                  }
                  disabled={disabled || isPending}
                  className="mt-0.5 size-4"
                />
                <span className={checked ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          หลัง commit ระบบจะ recompute drift ทุกสาขา + ตรวจ alert ทันที
        </p>
        <div className="flex items-center gap-2">
          <ConfirmDialog
            trigger={
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={isCancelling || isPending}
              >
                {isCancelling ? "กำลังยกเลิก..." : "ยกเลิก import นี้"}
              </Button>
            }
            title="ยกเลิก import นี้?"
            body="แถว pending จะถูกลบ · การทำงานนี้ย้อนกลับไม่ได้"
            confirmLabel="ยกเลิก import"
            cancelLabel="ไม่ใช่ตอนนี้"
            variant="danger"
            onConfirm={onCancelConfirmed}
          />
          <Button
            size="lg"
            type="button"
            onClick={onCommit}
            disabled={submitDisabled}
            title={blockerTooltip}
          >
            {isPending ? "กำลัง commit..." : "ยืนยัน commit"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
