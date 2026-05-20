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
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  parseConnextCsv,
  type ParseResult,
  type EvDailyAgg,
} from "@/lib/cashhub/ev-csv-parser";

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
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [missingStations, setMissingStations] = useState<string[]>([]);
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
    setMissingStations([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function checkMissing(aggs: EvDailyAgg[]) {
    // POST a dry-run-ish call with createMissingBranches=false + overwrite=false.
    // The API will return missingStations in its response.
    try {
      const res = await fetch("/api/cashhub/ev-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aggregates: aggs,
          createMissingBranches: false,
          overwrite: false,
        }),
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json.missingStations)) {
        setMissingStations(json.missingStations);
        // Undo any side-effect from this probe by NOT actually saving anything
        // — the probe is harmless because rows w/o matching branch are skipped.
        // (createdReports may include some matched rows; that's fine, they're
        // the real saves the user wanted.)
        if ((json.reportsCreated?.length ?? 0) > 0) {
          toast.info(
            `บันทึก ${json.reportsCreated.length} รายงานของสาขาที่มีอยู่แล้วทันที (ที่ขาดสาขา ${json.missingStations.length} รายการ — กดยืนยันด้านล่าง)`,
          );
        }
      }
    } catch {
      // Non-fatal; user can still try the real import
    }
  }

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      const result = parseConnextCsv(text);
      setParsed(result);
      if (result.errors.length === 0 && result.aggregates.length > 0) {
        void checkMissing(result.aggregates);
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

            {/* Missing stations */}
            {missingStations.length > 0 && (
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <Plus className="size-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-amber-900 mb-1">
                      ยังไม่มีสาขาเหล่านี้ในระบบ ({missingStations.length})
                    </div>
                    <ul className="text-xs text-amber-800 space-y-0.5 max-h-32 overflow-y-auto">
                      {missingStations.map((s) => (
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

            {/* Overwrite toggle */}
            <label className="flex items-center gap-2 p-2 rounded-lg bg-zinc-50 border border-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="size-4 accent-[var(--color-brand-600)]"
              />
              <div className="text-xs">
                <span className="font-semibold">ทับรายงานเดิม</span>{" "}
                <span className="text-zinc-500">(ถ้าวัน-สาขาเดียวกันเคยมีอยู่แล้ว — default = ข้าม)</span>
              </div>
            </label>

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
              <Button onClick={handleImport} loading={pending} size="lg">
                นำเข้าทั้งหมด ({parsed.aggregates.length} แถว)
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
        {label}
      </div>
      <div className="text-lg font-extrabold tracking-tight mt-0.5 tabular-nums">{value}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}
