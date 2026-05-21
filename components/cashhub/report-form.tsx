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
import { DatePickerPill } from "./date-picker-pill";
import { SlipCamera } from "./slip-camera";
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
  deadlineHHmm?: string;
  previousReference?: { totalSales: number; qty1: number };
  /** Rolling 7-day median baseline for spike alert. Falls back to previousReference if undefined. */
  spikeBaseline?: { totalSales: number; sampleDays: number };
  streak?: { current: number; lastDate: string | null } | null;
  // Anti-Stupidity Rule 2 — pre-computed list of last N days with status.
  // Approved dates appear locked in the dropdown so staff can't pick them.
  availableDates?: Array<{
    date: string;
    status: "open" | "submitted" | "approved";
  }>;
}

type FormValues = Record<string, string>;

/** Strip everything except digits and a single decimal point */
function sanitizeNumeric(s: string): string {
  // Remove non [0-9.] characters
  let cleaned = s.replace(/[^0-9.]/g, "");
  // Keep only the first dot
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  return cleaned;
}

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
  deadlineHHmm = "21:00",
  previousReference,
  spikeBaseline,
  streak,
  availableDates,
}: Props) {
  const router = useRouter();
  const [shift, setShift] = useState<string>(config.shifts[0] || "all");
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(config.fields.map((f) => [f.key, ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [shortageInfo, setShortageInfo] = useState<ShortageInfo | null>(null);
  const [shortageModalOpen, setShortageModalOpen] = useState(false);
  // OCR slip URL — เก็บเข้า extraFields ตอน submit (CEO 2026-05-20 D-020 follow-up)
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  // Anti-Stupidity Rule 3 — spike alert state.
  // When totalSales > previousReference × 1.5, ask once for confirmation
  // (does not block — user can confirm, but pause makes them check the figure).
  const [spikeConfirmed, setSpikeConfirmed] = useState(false);
  const [spikeModalOpen, setSpikeModalOpen] = useState(false);

  // Draft storage — server-side primary, localStorage offline-fallback.
  // 2026-05-20: ย้ายจาก localStorage-only เข้า DB (Branch Manager audit)
  // เพื่อกัน data loss เมื่อพนักงานเปลี่ยนเครื่อง/เครื่องสาธารณะ.
  const draftKey = `cashhub:draft:${branchId}:${reportDate}:${shift}`;
  const draftQuery = `branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(reportDate)}&shift=${encodeURIComponent(shift)}`;

  // Load draft on mount and shift change — server first, localStorage fallback
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/cashhub/drafts?${draftQuery}`, {
          method: "GET",
        });
        if (!cancelled && res.ok) {
          const json = (await res.json()) as { values: FormValues | null };
          /* eslint-disable react-hooks/set-state-in-effect */
          if (json.values) {
            setValues((cur) => ({ ...cur, ...json.values }));
            return;
          }
          /* eslint-enable react-hooks/set-state-in-effect */
        }
      } catch {
        // fall through to localStorage
      }

      // Fallback / offline path
      const saved = localStorage.getItem(draftKey);
      /* eslint-disable react-hooks/set-state-in-effect */
      if (!cancelled && saved) {
        try {
          const parsed = JSON.parse(saved) as FormValues;
          setValues((cur) => ({ ...cur, ...parsed }));
        } catch {
          /* ignore */
        }
      } else if (!cancelled) {
        // reset to empty when switching shifts
        setValues(Object.fromEntries(config.fields.map((f) => [f.key, ""])));
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, draftQuery]);

  // Save draft (debounced) — write to both localStorage (offline) + server
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = setTimeout(() => {
      const hasContent = Object.values(values).some((v) => v !== "");
      if (!hasContent) return;
      // localStorage fast + offline
      localStorage.setItem(draftKey, JSON.stringify(values));
      // server sync (fire and forget — error is OK, localStorage still has it)
      void fetch("/api/cashhub/drafts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          date: reportDate,
          shift,
          values,
        }),
      }).catch(() => {
        /* swallow — offline mode covered by localStorage */
      });
    }, 1000);
    return () => clearTimeout(handle);
  }, [values, draftKey, branchId, reportDate, shift]);

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
    // เงินเกิน OK · only block when received < sales (under)
    if (config.hasReconcile && !reconcileResult.isAcceptable) return false;
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

  // Spike detection (CASHHUB Rule 3) — prefer rolling 7-day median baseline
  // (Branch Manager audit · 2026-05-20) เพราะ "เมื่อวาน × 1.5" false-positive
  // ทุกจันทร์ (เสาร์-อาทิตย์ยอดต่ำ). Fall back ไปใช้ previousReference ถ้า
  // sample data ยังน้อยเกิน (เช่นสาขาเปิดใหม่). Threshold ×1.5 ตาม spec เดิม.
  const spikeBaselineValue =
    spikeBaseline && spikeBaseline.totalSales > 0
      ? spikeBaseline.totalSales
      : previousReference && previousReference.totalSales > 0
        ? previousReference.totalSales
        : 0;
  const spikeRatio =
    spikeBaselineValue > 0 ? numeric.totalSales / spikeBaselineValue : 0;
  const isSpiking = spikeRatio >= 1.5;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    // Rule 3: if today's amount is wildly higher than yesterday's, pause once
    // for the user to double-check. Confirmed via modal → setSpikeConfirmed →
    // resubmit will skip the check.
    if (isSpiking && !spikeConfirmed) {
      setSpikeModalOpen(true);
      return;
    }
    setSubmitting(true);

    // Extract optional rental / training fields when the config defines them
    const rentalField = config.fields.find((f) => f.column === "rentalIncome");
    const trainingField = config.fields.find(
      (f) => f.column === "trainingSessions",
    );

    // Custom fields (column = "_custom") → collect into extra_fields jsonb
    const extraFields: Record<string, string | number | null> = {};
    for (const f of config.fields) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((f.column as any) === "_custom") {
        const raw = values[f.key];
        if (raw === undefined || raw === "") {
          extraFields[f.key] = null;
        } else if (f.type === "currency" || f.type === "number") {
          const n = parseFloat(raw);
          extraFields[f.key] = Number.isFinite(n) ? n : null;
        } else {
          extraFields[f.key] = raw;
        }
      }
    }
    // Attach OCR slip URL if uploaded (Accountant audit · photo evidence)
    if (slipUrl) {
      extraFields.slip_url = slipUrl;
    }

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
      rentalIncome: rentalField
        ? parseFloat(values[rentalField.key] || "0") || 0
        : 0,
      trainingSessions: trainingField
        ? parseInt(values[trainingField.key] || "0", 10) || null
        : null,
      notes: values.notes || null,
      shortageInfo: numeric.shortage > 0 ? shortageInfo : null,
      extraFields,
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

      // Clear draft (both layers)
      localStorage.removeItem(draftKey);
      void fetch(`/api/cashhub/drafts?${draftQuery}`, {
        method: "DELETE",
      }).catch(() => {
        /* server cleanup best-effort */
      });
      toast.success("ส่งรายงานเรียบร้อย", {
        description: "รอผู้จัดการอนุมัติ",
      });

      // CASHHUB §11.2 Lean — when running inside LINE LIFF, close the window
      // so staff returns to LINE chat (no extra tap). Web fallback navigates
      // to /liff/status as before.
      setTimeout(async () => {
        try {
          if (typeof window !== "undefined") {
            const { getLiff } = await import("@/lib/line/liff-client");
            const liff = await getLiff();
            if (liff && liff.isInClient()) {
              liff.closeWindow();
              return;
            }
          }
        } catch {
          // fall through to web nav
        }
        router.push("/liff/status");
      }, 800);
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
      rental: [],
      training: [],
      custom: [],
    };
    for (const f of config.fields) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group]!.push(f);
    }
    return groups;
  }, [config]);

  return (
    <div className="pb-32 sm:pb-8">
      {/* Branch header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10 px-4 py-3 sm:px-6 safe-top">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{config.emoji}</div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate font-display">
              {config.label}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {branchCode} · {branchName}
            </div>
          </div>
          <div className="text-right shrink-0">
            {availableDates && availableDates.length > 0 ? (
              <DatePickerPill
                branchId={branchId}
                currentDate={reportDate}
                available={availableDates}
              />
            ) : (
              <Badge tone="brand">{reportDate}</Badge>
            )}
            <DeadlineCountdown deadlineHHmm={deadlineHHmm} />
          </div>
        </div>
        {streak && streak.current >= 1 && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Badge tone="success">
              🔥 Streak {streak.current} วัน — กรอกวันนี้เพื่อรักษาสถิติ
            </Badge>
          </div>
        )}
        {previousReference && previousReference.totalSales > 0 && (
          <div className="mt-2 text-xs text-zinc-500">
            อ้างอิง: เมื่อวาน{" "}
            <span className="font-semibold text-zinc-900 tabular-num">
              ฿{previousReference.totalSales.toLocaleString("th-TH")}
            </span>
            {previousReference.qty1 > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="tabular-num">
                  {previousReference.qty1.toLocaleString("th-TH")}
                </span>{" "}
                {config.fields.find((f) => f.key === "qty1")?.unit ?? ""}
              </>
            )}
          </div>
        )}
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
                        ? "bg-[var(--color-brand-600)] text-white shadow-soft"
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
                hintImageUrl={f.hintImageUrl}
                hintImageCaption={f.hintImageCaption}
              >
                <Input
                  id={f.key}
                  inputMode={f.numericOnly ? "decimal" : "text"}
                  pattern={f.numericOnly ? "[0-9]*\\.?[0-9]*" : undefined}
                  placeholder={f.placeholder}
                  value={values[f.key] || ""}
                  onChange={(e) =>
                    update(
                      f.key,
                      f.numericOnly
                        ? sanitizeNumeric(e.target.value)
                        : e.target.value,
                    )
                  }
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
                  hintImageUrl={f.hintImageUrl}
                  hintImageCaption={f.hintImageCaption}
                >
                  <Input
                    id={f.key}
                    inputMode={f.numericOnly ? "decimal" : "text"}
                    pattern={f.numericOnly ? "[0-9]*\\.?[0-9]*" : undefined}
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) =>
                      update(
                        f.key,
                        f.numericOnly
                          ? sanitizeNumeric(e.target.value)
                          : e.target.value,
                      )
                    }
                    prefixSlot={<span className="font-semibold">฿</span>}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </Field>
              ))}
              {/* OCR slip → auto-fill transfer · only show if "transfer" field exists */}
              {groupedFields.received!.some((f) => f.key === "transfer") && (
                <SlipCamera
                  currentSlipUrl={slipUrl}
                  onSlipUploaded={(url) => setSlipUrl(url || null)}
                  onAmountDetected={(amt) =>
                    update("transfer", String(amt))
                  }
                />
              )}
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
                  hintImageUrl={f.hintImageUrl}
                  hintImageCaption={f.hintImageCaption}
                >
                  <Input
                    id={f.key}
                    inputMode={f.numericOnly ? "decimal" : "text"}
                    pattern={f.numericOnly ? "[0-9]*\\.?[0-9]*" : undefined}
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) =>
                      update(
                        f.key,
                        f.numericOnly
                          ? sanitizeNumeric(e.target.value)
                          : e.target.value,
                      )
                    }
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
                    className="text-sm font-medium text-[var(--color-brand-700)] hover:underline shrink-0"
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

        {/* Anti-Stupidity Rule 3 — spike alert (sales × ≥1.5 of yesterday) */}
        {spikeModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4"
            onClick={() => setSpikeModalOpen(false)}
          >
            <div
              className="w-full sm:max-w-md bg-white rounded-2xl shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-3xl mb-3">🚨</div>
              <h3 className="text-lg font-bold text-zinc-900 font-display">
                ยอดวันนี้สูงกว่าปกติมาก
              </h3>
              <p className="text-sm text-zinc-700 mt-2 leading-relaxed">
                วันนี้กรอกไว้{" "}
                <strong className="tabular-num">
                  ฿{Math.round(numeric.totalSales).toLocaleString("th-TH")}
                </strong>{" "}
                — สูงกว่า{" "}
                {spikeBaseline ? (
                  <>
                    ค่ามัธยฐาน {spikeBaseline.sampleDays} วัน{" "}
                    <strong className="text-zinc-500 tabular-num">
                      ฿{Math.round(spikeBaseline.totalSales).toLocaleString("th-TH")}
                    </strong>
                  </>
                ) : (
                  <>
                    เมื่อวาน{" "}
                    <strong className="text-zinc-500 tabular-num">
                      {previousReference
                        ? `฿${Math.round(previousReference.totalSales).toLocaleString("th-TH")}`
                        : "—"}
                    </strong>
                  </>
                )}{" "}
                ถึง <strong>{spikeRatio.toFixed(1)} เท่า</strong>
              </p>
              <p className="text-xs text-zinc-500 mt-3">
                ตรวจตัวเลขอีกครั้งก่อนกด &ldquo;ยืนยันถูกต้อง&rdquo; — ระบบจะ flag ให้ผู้จัดการรู้ตอน
                approve เพื่อลด error
              </p>
              <div className="mt-5 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSpikeModalOpen(false)}
                  className="flex-1"
                >
                  ✏️ แก้ไขตัวเลข
                </Button>
                <Button
                  onClick={() => {
                    setSpikeConfirmed(true);
                    setSpikeModalOpen(false);
                    // re-trigger submit
                    setTimeout(() => handleSubmit(), 50);
                  }}
                  className="flex-1"
                >
                  ✅ ยืนยันถูกต้อง
                </Button>
              </div>
            </div>
          </div>
        )}

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
                  hintImageUrl={f.hintImageUrl}
                  hintImageCaption={f.hintImageCaption}
                >
                  <textarea
                    id={f.key}
                    rows={3}
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) =>
                      update(
                        f.key,
                        f.numericOnly
                          ? sanitizeNumeric(e.target.value)
                          : e.target.value,
                      )
                    }
                    inputMode={f.numericOnly ? "decimal" : undefined}
                    maxLength={500}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
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
                : config.hasReconcile &&
                    reconcileResult.status === "under" &&
                    numeric.totalSales > 0
                  ? "ยอดรับยังขาด — เติมให้ครบก่อน"
                  : "กรอกให้ครบก่อน"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Isolated countdown chip — owns the 30s setInterval that would otherwise
 * re-render the entire 800-line ReportForm (incl. controlled inputs).
 * Was: every keystroke could collide with a clock tick mid-typing.
 */
function DeadlineCountdown({ deadlineHHmm }: { deadlineHHmm: string }) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const deadline = useMemo(() => {
    const [h, m] = deadlineHHmm.split(":").map((x) => parseInt(x, 10));
    const d = new Date();
    d.setHours(h ?? 21, m ?? 0, 0, 0);
    return d;
  }, [deadlineHHmm]);

  const remainingMs = deadline.getTime() - now.getTime();
  const isPastDeadline = remainingMs <= 0;
  const remainingHours = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
  const remainingMinutes = Math.max(
    0,
    Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)),
  );

  return (
    <div
      className={cn(
        "text-[11px] mt-0.5 tabular-num font-semibold",
        isPastDeadline ? "text-red-700" : "text-zinc-500",
      )}
    >
      {isPastDeadline
        ? `⏰ เลย Deadline ${deadlineHHmm} แล้ว`
        : `⏰ เหลือ ${remainingHours}:${String(remainingMinutes).padStart(2, "0")} ก่อน ${deadlineHHmm}`}
    </div>
  );
}
