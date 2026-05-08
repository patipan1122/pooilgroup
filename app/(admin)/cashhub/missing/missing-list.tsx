"use client";

// Missing reports list + reason modal.
// CASHHUB §11.5 — Manager picks a reason from a fixed set; เจ้าของอ่านได้ใน Dashboard
// ไม่ต้องโทรถาม.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calendar, Building2, MessageSquare, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface MissingRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  businessType: string;
  missing: Array<{
    date: string;
    reasonType: string | null;
    reasonText: string | null;
  }>;
}

const REASON_OPTIONS: Array<{ value: string; label: string; emoji: string }> = [
  { value: "sick", label: "ผู้จัดการ/พนักงานลาป่วย", emoji: "🤒" },
  { value: "holiday", label: "วันหยุดพิเศษของสาขา", emoji: "🏖️" },
  { value: "system", label: "ระบบมีปัญหา", emoji: "⚠️" },
  { value: "waiting", label: "รอข้อมูลจากทีม", emoji: "⏳" },
  { value: "other", label: "อื่นๆ", emoji: "📝" },
];

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  REASON_OPTIONS.map((r) => [r.value, `${r.emoji} ${r.label}`]),
);

export function MissingList({ rows }: { rows: MissingRow[] }) {
  const [open, setOpen] = useState<{
    branchId: string;
    date: string;
    initialType?: string;
    initialText?: string;
  } | null>(null);

  return (
    <>
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.branchId}
            className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5"
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="font-bold text-zinc-900 text-base sm:text-lg flex items-center gap-2">
                  <Building2 className="size-4 text-zinc-400" />
                  {row.branchCode} · {row.branchName}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {row.businessType}
                </div>
              </div>
              <span className="text-sm font-bold tabular-num text-red-600">
                ขาด {row.missing.length} วัน
              </span>
            </div>

            <ul className="space-y-1.5">
              {row.missing.map((m) => (
                <li
                  key={m.date}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="size-3.5 text-zinc-400 shrink-0" />
                    <span className="font-mono tabular-num text-zinc-900 font-bold">
                      {m.date}
                    </span>
                    {m.reasonType ? (
                      <span className="ml-2 text-xs text-zinc-700">
                        {REASON_LABEL[m.reasonType] ?? m.reasonType}
                        {m.reasonText && (
                          <span className="text-zinc-500"> — “{m.reasonText}”</span>
                        )}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-amber-700">
                        ⚠️ ยังไม่ได้แจ้งเหตุผล
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setOpen({
                        branchId: row.branchId,
                        date: m.date,
                        initialType: m.reasonType ?? undefined,
                        initialText: m.reasonText ?? undefined,
                      })
                    }
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors",
                      m.reasonType
                        ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        : "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] hover:border-[var(--color-brand-500)]",
                    )}
                  >
                    <MessageSquare className="size-3" />
                    {m.reasonType ? "แก้" : "แจ้งเหตุผล"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {open && (
        <ReasonDialog
          branchId={open.branchId}
          date={open.date}
          initialType={open.initialType}
          initialText={open.initialText}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

interface DialogProps {
  branchId: string;
  date: string;
  initialType?: string;
  initialText?: string;
  onClose: () => void;
}

function ReasonDialog({
  branchId,
  date,
  initialType,
  initialText,
  onClose,
}: DialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reasonType, setReasonType] = useState<string>(initialType ?? "");
  const [reasonText, setReasonText] = useState<string>(initialText ?? "");

  function submit() {
    if (!reasonType) {
      toast.error("เลือกเหตุผลก่อน");
      return;
    }
    if (reasonType === "other" && !reasonText.trim()) {
      toast.error("กรอกเหตุผลเพิ่มเติม");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/cashhub/missing-reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          reportDate: date,
          reasonType,
          reasonText: reasonText.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกเหตุผลแล้ว");
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-2xl shadow-2xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base sm:text-lg font-bold text-zinc-900 font-display">
          แจ้งเหตุผล — ไม่กรอกรายงาน
        </h3>
        <p className="text-xs text-zinc-500 mt-0.5 font-mono tabular-num">
          {date}
        </p>

        <div className="mt-4 space-y-2">
          {REASON_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-colors",
                reasonType === opt.value
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                  : "border-zinc-200 hover:bg-zinc-50",
              )}
            >
              <input
                type="radio"
                name="reasonType"
                value={opt.value}
                checked={reasonType === opt.value}
                onChange={(e) => setReasonType(e.target.value)}
                className="size-4"
              />
              <span className="text-xl">{opt.emoji}</span>
              <span className="text-sm font-medium text-zinc-900">
                {opt.label}
              </span>
              {reasonType === opt.value && (
                <Check className="size-4 ml-auto text-[var(--color-brand-700)]" />
              )}
            </label>
          ))}
        </div>

        {(reasonType === "other" || reasonText) && (
          <div className="mt-3">
            <label className="text-xs font-bold text-zinc-700 block mb-1">
              รายละเอียดเพิ่ม{reasonType === "other" ? " *" : " (ถ้ามี)"}
            </label>
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value.slice(0, 500))}
              placeholder="เช่น พนักงานลาออก กำลังหาคนใหม่"
              rows={3}
              className="w-full rounded-xl border-2 border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand-500)]"
            />
            <p className="text-[10px] text-zinc-400 mt-0.5">
              {reasonText.length}/500
            </p>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            ยกเลิก
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !reasonType}
            className="flex-1"
          >
            {pending ? "กำลังบันทึก..." : "บันทึกเหตุผล"}
          </Button>
        </div>
      </div>
    </div>
  );
}
