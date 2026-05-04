"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReconcileIndicator } from "./reconcile-indicator";
import { ShortageModal, type ShortageInfo } from "./shortage-modal";
import { reconcile } from "@/lib/cashhub/reconcile";
import { formatBaht } from "@/lib/utils/format";
import type {
  BusinessTypeConfig,
  FieldConfig,
} from "@/constants/business-types";
import { CheckCircle2, MoonStar, Sun, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Props {
  branchId: string;
  branchCode: string;
  branchName: string;
  config: BusinessTypeConfig;
  reportDate: string; // YYYY-MM-DD
}

type FormValues = Record<string, string>;

const SHIFT_ICONS: Record<string, React.ReactNode> = {
  morning: <Sunrise className="size-4" />,
  midday: <Sun className="size-4" />,
  evening: <MoonStar className="size-4" />,
  all: null,
};

const SHIFT_LABEL: Record<string, string> = {
  morning: "กะเช้า",
  midday: "กลางวัน",
  evening: "กะเย็น",
  all: "ทั้งวัน",
};

export function ReportForm({
  branchId,
  branchCode,
  branchName,
  config,
  reportDate,
}: Props) {
  const router = useRouter();
  const [shift, setShift] = useState<string>(config.shifts[0] || "all");
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(config.fields.map((f) => [f.key, ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [shortageInfo, setShortageInfo] = useState<ShortageInfo | null>(null);
  const [shortageModalOpen, setShortageModalOpen] = useState(false);

  // Draft storage key per branch+date+shift
  const draftKey = `cashhub:draft:${branchId}:${reportDate}:${shift}`;

  // Load draft on mount and shift change
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as FormValues;
        setValues((cur) => ({ ...cur, ...parsed }));
      } catch {
        /* ignore */
      }
    } else {
      // reset to empty when switching shifts
      setValues(Object.fromEntries(config.fields.map((f) => [f.key, ""])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Save draft (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = setTimeout(() => {
      const hasContent = Object.values(values).some((v) => v !== "");
      if (hasContent) {
        localStorage.setItem(draftKey, JSON.stringify(values));
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [values, draftKey]);

  // Aggregate numeric values for reconcile
  const numeric = useMemo(() => {
    const get = (k: string) => parseFloat(values[k] || "0") || 0;
    return {
      totalSales: get("totalSales"),
      cash: get("cash"),
      transfer: get("transfer"),
      card: get("card"),
      credit: get("credit"),
      shortage: get("shortage"),
    };
  }, [values]);

  const reconcileResult = useMemo(() => reconcile(numeric), [numeric]);

  const canSubmit = useMemo(() => {
    if (numeric.totalSales <= 0) return false;
    // required fields filled
    for (const f of config.fields) {
      if (f.required && !values[f.key]) return false;
    }
    if (config.hasReconcile && !reconcileResult.isBalanced) return false;
    // If shortage > 0, must have shortageInfo or note
    if (numeric.shortage > 0 && !shortageInfo) return false;
    return true;
  }, [config, values, numeric, reconcileResult, shortageInfo]);

  function update(key: string, value: string) {
    // strip non-digits/dots for numeric fields
    const field = config.fields.find((f) => f.key === key);
    if (field?.type === "number" || field?.type === "currency") {
      value = value.replace(/[^\d.]/g, "");
    }
    setValues((v) => ({ ...v, [key]: value }));

    // When shortage is entered, prompt for details
    if (key === "shortage") {
      const num = parseFloat(value || "0") || 0;
      if (num > 0 && !shortageInfo) {
        // delay a tick so input registers
        setTimeout(() => setShortageModalOpen(true), 100);
      }
      if (num === 0 && shortageInfo) {
        setShortageInfo(null);
      }
    }
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    const payload = {
      branchId,
      reportDate,
      shift,
      totalSales: numeric.totalSales,
      qty1: parseFloat(values.qty1 || "0") || null,
      qty1Unit: config.fields.find((f) => f.key === "qty1")?.qtyUnit ?? null,
      qty2: parseFloat(values.qty2 || "0") || null,
      qty2Unit: config.fields.find((f) => f.key === "qty2")?.qtyUnit ?? null,
      cash: numeric.cash,
      transfer: numeric.transfer,
      card: numeric.card,
      credit: numeric.credit,
      shortage: numeric.shortage,
      notes: values.notes || null,
      shortageInfo: numeric.shortage > 0 ? shortageInfo : null,
    };

    try {
      const res = await fetch("/api/cashhub/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "ส่งรายงานไม่สำเร็จ");
        setSubmitting(false);
        return;
      }

      // Clear draft
      localStorage.removeItem(draftKey);
      toast.success("ส่งรายงานเรียบร้อย", {
        description: "รอผู้จัดการอนุมัติ",
      });

      // navigate to status
      setTimeout(() => router.push("/liff/status"), 800);
    } catch (err) {
      // network error — keep draft, show offline message
      const msg = err instanceof Error ? err.message : "เน็ตมีปัญหา";
      toast.error("ส่งรายงานไม่ได้", {
        description: `${msg} — บันทึกไว้ในเครื่องแล้ว`,
      });
      setSubmitting(false);
    }
  }

  const groupedFields = useMemo(() => {
    const groups: Record<string, FieldConfig[]> = {
      sales: [],
      received: [],
      shortage: [],
      notes: [],
    };
    for (const f of config.fields) groups[f.group]!.push(f);
    return groups;
  }, [config]);

  return (
    <div className="pb-32 sm:pb-8">
      {/* Branch header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10 px-4 py-3 sm:px-6 safe-top">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{config.emoji}</div>
          <div className="min-w-0">
            <div className="font-semibold truncate font-display">
              {config.label}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {branchCode} · {branchName}
            </div>
          </div>
          <div className="ml-auto">
            <Badge tone="brand">{reportDate}</Badge>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-4">
        {/* Shift selector */}
        {config.hasShifts && config.shifts.length > 1 && (
          <Card>
            <CardBody className="!py-3">
              <div className="text-xs text-zinc-500 mb-2">เลือกกะ</div>
              <div className="grid grid-cols-3 gap-2">
                {config.shifts.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setShift(s)}
                    className={cn(
                      "py-3 rounded-xl text-sm font-medium transition-colors flex flex-col items-center gap-1",
                      shift === s
                        ? "bg-[--color-brand-600] text-white shadow-soft"
                        : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100",
                    )}
                  >
                    {SHIFT_ICONS[s]}
                    {SHIFT_LABEL[s] || s}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Sales */}
        <Card>
          <CardHeader>
            <CardTitle>ยอดขาย</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {groupedFields.sales!.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                required={f.required}
                htmlFor={f.key}
              >
                <Input
                  id={f.key}
                  inputMode={f.type === "currency" || f.type === "number" ? "decimal" : "text"}
                  pattern={f.type === "currency" || f.type === "number" ? "[0-9]*\\.?[0-9]*" : undefined}
                  placeholder={f.placeholder}
                  value={values[f.key] || ""}
                  onChange={(e) => update(f.key, e.target.value)}
                  prefixSlot={
                    f.type === "currency" ? (
                      <span className="font-semibold">฿</span>
                    ) : null
                  }
                  suffixSlot={
                    f.unit && f.type !== "currency" ? <span>{f.unit}</span> : null
                  }
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
              </Field>
            ))}
          </CardBody>
        </Card>

        {/* Received */}
        {groupedFields.received!.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>รับเงินมาจาก</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {groupedFields.received!.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  htmlFor={f.key}
                >
                  <Input
                    id={f.key}
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) => update(f.key, e.target.value)}
                    prefixSlot={<span className="font-semibold">฿</span>}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </Field>
              ))}
            </CardBody>
          </Card>
        )}

        {/* Shortage */}
        {groupedFields.shortage!.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>เงินขาด</span>
                {numeric.shortage > 0 && <Badge tone="warning">มีการขาด</Badge>}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {groupedFields.shortage!.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  htmlFor={f.key}
                >
                  <Input
                    id={f.key}
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) => update(f.key, e.target.value)}
                    prefixSlot={<span className="font-semibold">฿</span>}
                  />
                </Field>
              ))}
              {numeric.shortage > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="text-sm min-w-0">
                    {shortageInfo ? (
                      <>
                        <span className="font-medium">
                          {shortageInfo.isIdentified
                            ? shortageInfo.personName
                            : "รวมร้าน"}
                        </span>
                        {shortageInfo.note && (
                          <span className="text-xs text-zinc-600 block truncate">
                            {shortageInfo.note}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-800">ยังไม่ได้ระบุ</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShortageModalOpen(true)}
                    className="text-sm font-medium text-[--color-brand-700] hover:underline shrink-0"
                  >
                    {shortageInfo ? "แก้" : "ระบุ"}
                  </button>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        <ShortageModal
          open={shortageModalOpen}
          amount={numeric.shortage}
          branchId={branchId}
          initial={shortageInfo}
          onClose={() => setShortageModalOpen(false)}
          onConfirm={(info) => setShortageInfo(info)}
        />

        {/* Reconcile indicator (live) */}
        {config.hasReconcile && (
          <ReconcileIndicator
            result={reconcileResult}
            totalSales={numeric.totalSales}
          />
        )}

        {/* Notes */}
        {groupedFields.notes!.length > 0 && (
          <Card>
            <CardBody>
              {groupedFields.notes!.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  optional
                  hint={f.hint}
                  htmlFor={f.key}
                >
                  <textarea
                    id={f.key}
                    rows={3}
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) => update(f.key, e.target.value)}
                    maxLength={500}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none focus:border-[--color-brand-500] focus:ring-2 focus:ring-[--color-brand-100]"
                  />
                </Field>
              ))}
            </CardBody>
          </Card>
        )}
      </div>

      {/* Sticky submit bar */}
      <div className="fixed sm:sticky bottom-0 left-0 right-0 z-20 bg-white border-t border-zinc-200 px-4 py-3 safe-bottom">
        <div className="max-w-xl mx-auto">
          <Button
            type="button"
            size="xl"
            fullWidth
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit || submitting}
            className={canSubmit ? "" : "!bg-zinc-200 !text-zinc-500"}
          >
            <CheckCircle2 className="size-5" />
            {submitting
              ? "กำลังส่ง..."
              : canSubmit
                ? `ส่งรายงาน · ${formatBaht(numeric.totalSales)}`
                : config.hasReconcile && !reconcileResult.isBalanced && numeric.totalSales > 0
                  ? "ยอดยังไม่ตรง"
                  : "กรอกให้ครบก่อน"}
          </Button>
        </div>
      </div>
    </div>
  );
}
