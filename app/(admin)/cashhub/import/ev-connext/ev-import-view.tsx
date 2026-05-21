"use client";

import { useState, useTransition, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Plus,
  RotateCcw,
  Sparkles,
  Equal,
  ArrowRight,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  parseConnextCsv,
  type ParseResult,
  type EvDailyAgg,
} from "@/lib/cashhub/ev-csv-parser";

interface PreviewResult {
  summary: {
    total: number;
    new: number;
    same: number;
    changed: number;
    skippedNoBranch: number;
  };
  missingStations: string[];
  changedSample: Array<{
    stationName: string;
    reportDate: string;
    old: { totalSales: number; sessions: number | null; kwh: number | null };
    new: { totalSales: number; sessions: number; kwh: number };
  }>;
  changedTotal: number;
}

const fmt = new Intl.NumberFormat("th-TH");
const fmtMoney = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EvImportView() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [overwrite, setOverwrite] = useState(false);

  const totals = useMemo(() => {
    if (!parsed) return { sessions: 0, kwh: 0, revenue: 0 };
    return parsed.aggregates.reduce(
      (acc, a) => ({
        sessions: acc.sessions + a.sessions,
        kwh: acc.kwh + a.totalKwh,
        revenue: acc.revenue + a.totalRevenue,
      }),
      { sessions: 0, kwh: 0, revenue: 0 },
    );
  }, [parsed]);

  function reset() {
    setFileName(null);
    setParsed(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function loadPreview(aggs: EvDailyAgg[]) {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/cashhub/ev-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aggregates: aggs }),
      });
      const json = await res.json();
      if (res.ok && json.summary) {
        setPreview(json as PreviewResult);
      } else {
        toast.error(json.error || "เปรียบเทียบข้อมูลเดิมไม่สำเร็จ");
      }
    } catch {
      toast.error("เครือข่ายมีปัญหา ลองใหม่อีกครั้ง");
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setPreview(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      const result = parseConnextCsv(text);
      setParsed(result);
      if (result.errors.length === 0 && result.aggregates.length > 0) {
        void loadPreview(result.aggregates);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function handleImport() {
    if (!parsed || parsed.aggregates.length === 0) return;
    startTransition(async () => {
      const res = await fetch("/api/cashhub/ev-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aggregates: parsed.aggregates,
          createMissingBranches: createMissing,
          overwrite,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "นำเข้าไม่สำเร็จ");
        return;
      }
      const lines = [
        `สร้างสาขาใหม่ ${json.createdBranches?.length ?? 0} สาขา`,
        `บันทึกรายงาน ${json.reportsCreated?.length ?? 0} รายการ`,
        json.reportsUpdated?.length ? `อัปเดต ${json.reportsUpdated.length} รายการ` : "",
        json.skipped?.length ? `ข้าม ${json.skipped.length} รายการ` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`นำเข้าเรียบร้อย — ${lines}`);
      reset();
      router.push("/cashhub/dashboard");
      router.refresh();
    });
  }

  return (
    <>
      {/* Upload area */}
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-4" />
            อัปโหลดไฟล์ CSV
          </CardTitle>
        </CardHeader>
        <CardBody>
          {!fileName ? (
            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-zinc-300 rounded-xl p-8 text-center hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/40 transition-colors">
                <Upload className="size-8 text-zinc-400 mx-auto mb-2" />
                <p className="text-sm font-semibold">คลิกหรือลากไฟล์ CSV มาวางที่นี่</p>
                <p className="text-xs text-zinc-500 mt-1">
                  รองรับไฟล์ที่ Export จาก Looker Studio (UTF-8)
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          ) : (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-50 border border-zinc-200">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="size-5 text-zinc-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{fileName}</div>
                  {parsed && parsed.aggregates.length > 0 && (
                    <div className="text-[11px] text-zinc-500">
                      {parsed.rows.length.toLocaleString()} session · {parsed.stations.length}{" "}
                      สถานี · {parsed.dateRange?.from} → {parsed.dateRange?.to}
                    </div>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-3.5" />
                เปลี่ยนไฟล์
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Errors */}
      {parsed && parsed.errors.length > 0 && (
        <Card className="mt-4 border-rose-200 bg-rose-50">
          <CardBody>
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-bold text-rose-900 mb-1">อ่านไฟล์ไม่ออก</div>
                <ul className="text-xs text-rose-800 space-y-0.5 list-disc pl-4">
                  {parsed.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Preview */}
      {parsed && parsed.aggregates.length > 0 && (
        <Card className="mt-4 animate-fade-up delay-150">
          <CardHeader>
            <CardTitle>ตรวจสอบก่อนนำเข้า</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-3">
              <Stat label="รายงานทั้งหมด" value={fmt.format(parsed.aggregates.length)} sub="row" />
              <Stat label="Session" value={fmt.format(totals.sessions)} sub="ครั้ง" />
              <Stat label="ยอดรวม" value={fmtMoney.format(totals.revenue)} sub={`${fmt.format(Math.round(totals.kwh))} kWh`} />
            </div>

            {/* Warnings */}
            {parsed.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                {parsed.warnings.map((w, i) => (
                  <div key={i}>⚠️ {w}</div>
                ))}
              </div>
            )}

            {/* Diff vs existing data — heart of "ตรวจก่อนลง" UX */}
            {previewLoading && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                ⏳ กำลังเปรียบเทียบกับข้อมูลเดิมในระบบ...
              </div>
            )}

            {preview && (
              <div className="rounded-xl border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-3 space-y-3">
                <div className="text-sm font-bold flex items-center gap-1.5">
                  📊 เปรียบเทียบกับข้อมูลเดิมในระบบ
                </div>

                {/* Diff counts */}
                <div className="grid grid-cols-3 gap-2">
                  <DiffStat
                    Icon={Sparkles}
                    tone="brand"
                    label="ใหม่"
                    value={preview.summary.new}
                    sub="จะสร้าง"
                  />
                  <DiffStat
                    Icon={Equal}
                    tone="muted"
                    label="เหมือนเดิม"
                    value={preview.summary.same}
                    sub="ค่าตรงกัน · ข้าม"
                  />
                  <DiffStat
                    Icon={ArrowRight}
                    tone={preview.summary.changed > 0 ? "warn" : "muted"}
                    label="ค่าเปลี่ยน"
                    value={preview.summary.changed}
                    sub="ติ๊ก overwrite ถ้าจะอัปเดต"
                  />
                </div>

                {preview.summary.skippedNoBranch > 0 && (
                  <div className="text-[11px] text-zinc-500">
                    ⚠️ {preview.summary.skippedNoBranch} แถวขาดสาขาในระบบ — ต้องสร้างสาขาก่อนถึงจะนำเข้าได้
                  </div>
                )}

                {/* Sample changed rows */}
                {preview.changedSample.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <div className="text-[11px] font-bold text-amber-900 mb-1">
                      ตัวอย่าง "ค่าเปลี่ยน" (
                      {preview.changedSample.length} จาก {preview.changedTotal})
                    </div>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-amber-700">
                          <th className="text-left py-0.5">วัน · สาขา</th>
                          <th className="text-right py-0.5">เดิม</th>
                          <th className="text-right py-0.5">ใหม่</th>
                          <th className="text-right py-0.5">Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.changedSample.map((c) => {
                          const delta = c.new.totalSales - c.old.totalSales;
                          return (
                            <tr
                              key={`${c.stationName}__${c.reportDate}`}
                              className="border-t border-amber-200/60"
                            >
                              <td className="py-0.5 truncate max-w-[180px]">
                                <span className="text-amber-900">{c.reportDate}</span>{" "}
                                <span className="text-amber-700">· {c.stationName}</span>
                              </td>
                              <td className="text-right tabular-nums text-amber-900">
                                {fmtMoney.format(c.old.totalSales)}
                              </td>
                              <td className="text-right tabular-nums font-semibold text-amber-900">
                                {fmtMoney.format(c.new.totalSales)}
                              </td>
                              <td
                                className={
                                  "text-right tabular-nums font-bold " +
                                  (delta >= 0 ? "text-emerald-700" : "text-rose-700")
                                }
                              >
                                {delta >= 0 ? "+" : ""}
                                {fmtMoney.format(delta)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Missing stations */}
            {preview && preview.missingStations.length > 0 && (
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <Plus className="size-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-amber-900 mb-1">
                      ยังไม่มีสาขาเหล่านี้ในระบบ ({preview.missingStations.length})
                    </div>
                    <ul className="text-xs text-amber-800 space-y-0.5 max-h-32 overflow-y-auto">
                      {preview.missingStations.map((s) => (
                        <li key={s} className="truncate">• {s}</li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createMissing}
                        onChange={(e) => setCreateMissing(e.target.checked)}
                        className="size-4 accent-[var(--color-brand-600)]"
                      />
                      <span className="text-xs font-semibold text-amber-900">
                        สร้างให้อัตโนมัติ (business_type = EV Station · Pooil Oil ·
                        deadline 21:00 — รายละเอียดอื่นเติมภายหลัง)
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Overwrite toggle — only show if there are actual changes to overwrite */}
            {preview && preview.summary.changed > 0 && (
              <label className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border-2 border-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="size-4 accent-[var(--color-brand-600)]"
                />
                <div className="text-xs">
                  <span className="font-bold text-amber-900">
                    อัปเดตรายงาน {preview.summary.changed} รายการที่ค่าเปลี่ยน
                  </span>{" "}
                  <span className="text-amber-700">(default = ข้าม · ไม่ทับ)</span>
                </div>
              </label>
            )}

            {/* Aggregate table */}
            <div className="rounded-xl border border-zinc-200 overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold text-zinc-600">วันที่</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-zinc-600">สาขา</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-zinc-600">session</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-zinc-600">kWh</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-zinc-600">รายได้</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.aggregates.slice(0, 200).map((a) => (
                      <tr key={`${a.stationName}__${a.reportDate}`} className="border-t border-zinc-100">
                        <td className="px-2 py-1 text-zinc-700">{a.reportDate}</td>
                        <td className="px-2 py-1 text-zinc-700 truncate max-w-[260px]">{a.stationName}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.sessions}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt.format(Math.round(a.totalKwh))}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">
                          {fmtMoney.format(a.totalRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.aggregates.length > 200 && (
                <div className="text-[11px] text-zinc-500 text-center py-1.5 border-t border-zinc-100 bg-zinc-50">
                  แสดง 200 จาก {parsed.aggregates.length} แถว · นำเข้าจริงครบทุกแถว
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Badge tone="neutral">
                <CheckCircle2 className="size-3 mr-1" />
                Audit log จะบันทึก
              </Badge>
              <Button
                onClick={handleImport}
                loading={pending}
                disabled={previewLoading || !preview}
                size="lg"
              >
                {confirmButtonLabel(preview, overwrite, parsed.aggregates.length)}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function confirmButtonLabel(
  preview: PreviewResult | null,
  overwrite: boolean,
  fallbackCount: number,
): string {
  if (!preview) return `นำเข้าทั้งหมด (${fallbackCount} แถว)`;
  const willWrite =
    preview.summary.new + (overwrite ? preview.summary.changed : 0);
  if (willWrite === 0) {
    return "ไม่มีรายงานที่จะเขียน (ทุกแถวเหมือนเดิม)";
  }
  const parts = [`สร้างใหม่ ${preview.summary.new}`];
  if (overwrite && preview.summary.changed > 0) {
    parts.push(`อัปเดต ${preview.summary.changed}`);
  }
  return `ยืนยันนำเข้า · ${parts.join(" · ")}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="text-xs font-bold text-zinc-500">
        {label}
      </div>
      <div className="text-lg font-extrabold tracking-tight mt-0.5 tabular-nums">{value}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}

function DiffStat({
  Icon,
  tone,
  label,
  value,
  sub,
}: {
  Icon: typeof Sparkles;
  tone: "brand" | "warn" | "muted";
  label: string;
  value: number;
  sub: string;
}) {
  const toneClass =
    tone === "brand"
      ? "border-[var(--color-brand-300)] bg-white"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50"
        : "border-zinc-200 bg-white";
  const iconClass =
    tone === "brand"
      ? "text-[var(--color-brand-600)]"
      : tone === "warn"
        ? "text-amber-600"
        : "text-zinc-400";
  return (
    <div className={`rounded-lg border-2 p-2.5 ${toneClass}`}>
      <div className="flex items-center gap-1 text-xs font-bold text-zinc-600">
        <Icon className={`size-3 ${iconClass}`} />
        {label}
      </div>
      <div className="text-2xl font-extrabold tabular-nums mt-0.5">{value}</div>
      <div className="text-[10px] text-zinc-500">{sub}</div>
    </div>
  );
}
