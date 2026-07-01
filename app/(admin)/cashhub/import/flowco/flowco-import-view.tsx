"use client";

import { useState } from "react";
import {
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  RotateCcw,
  Fuel,
} from "lucide-react";

interface Summary {
  total: number;
  new: number;
  same: number;
  changed: number;
  unmappedDays: number;
  excludedDays: number;
  branches: number;
  baht: number;
  mappedStations: number;
}
interface Unmapped {
  steId: number;
  days: number;
  totalSales: number;
}
interface Preview {
  ok: true;
  dateFrom: string;
  dateTo: string;
  summary: Summary;
  reconFlags: number;
  unmapped: Unmapped[];
  excluded: Unmapped[];
  changedSample: Array<{
    branchName: string;
    reportDate: string;
    old: number | null;
    new: number;
  }>;
}
interface CommitResult {
  ok: true;
  created: number;
  updated: number;
  same: number;
  total: number;
  unmappedDays: number;
  unmapped: Unmapped[];
  excluded: Unmapped[];
  reconFlags: number;
  baht: number;
}

const baht = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export function FlowcoImportView({
  defaultFrom,
  defaultTo,
  canImport,
}: {
  defaultFrom: string | null;
  defaultTo: string | null;
  canImport: boolean;
}) {
  const [dateFrom, setDateFrom] = useState(defaultFrom ?? "");
  const [dateTo, setDateTo] = useState(defaultTo ?? "");
  const [busy, setBusy] = useState<null | "preview" | "commit">(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function runPreview() {
    if (!dateFrom || !dateTo) {
      setError("กรุณาเลือกช่วงวันที่");
      return;
    }
    setBusy("preview");
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const res = await fetch("/api/cashhub/flowco-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "ดึงข้อมูลไม่สำเร็จ");
      else setPreview(data as Preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runCommit() {
    setBusy("commit");
    setError(null);
    try {
      const res = await fetch("/api/cashhub/flowco-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "บันทึกไม่สำเร็จ");
      else setResult(data as CommitResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---- success ----
  if (result) {
    return (
      <div className="rounded-2xl border-2 border-[var(--ch-ok)] bg-[var(--ch-ok-bg,#ecfdf5)] p-5 animate-fade-up">
        <div className="flex items-center gap-2 text-[var(--ch-ok)] font-bold text-lg">
          <CheckCircle2 className="size-5" /> นำเข้าสำเร็จ
        </div>
        <ul className="mt-3 text-sm text-[var(--ch-text)] space-y-1">
          <li>
            • เพิ่มใหม่ {result.created} วัน · อัปเดต {result.updated} วัน · เหมือนเดิม{" "}
            {result.same} วัน (รวมยอด {baht(result.baht)})
          </li>
          {result.unmappedDays > 0 && (
            <li className="text-[#b45309]">
              • ข้าม {result.unmappedDays} วันจากสาขาที่ยังไม่จับคู่ (
              {result.unmapped.map((u) => u.steId).join(", ")})
            </li>
          )}
          {result.reconFlags > 0 && (
            <li className="text-[#b45309]">
              • {result.reconFlags} วันที่ยอดขายกับวิธีจ่ายต่างกันเกิน ฿5 — ควรตรวจ
            </li>
          )}
        </ul>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <a
            href="/cashhub/dashboard"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold"
          >
            ไปหน้าภาพรวม →
          </a>
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--ch-border)] px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold"
          >
            <RotateCcw className="size-3.5" /> นำเข้าอีกครั้ง
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* date range + pull */}
      <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-4 animate-fade-up space-y-3">
        <div className="flex items-center gap-2 font-bold text-[var(--ch-text)] text-sm">
          <Calendar className="size-4 text-[var(--ch-brand)]" /> เลือกช่วงวันที่
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--ch-text-2)]">
            ตั้งแต่
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)]"
            />
          </label>
          <label className="text-xs text-[var(--ch-text-2)]">
            ถึง
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)]"
            />
          </label>
        </div>
        <button
          onClick={runPreview}
          disabled={busy !== null || !canImport}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 min-h-[44px] w-full text-sm font-semibold disabled:opacity-60"
        >
          {busy === "preview" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          ตรวจข้อมูลก่อนนำเข้า
        </button>
        {!canImport && (
          <p className="text-xs text-[#b45309]">
            ต้องจับคู่สาขาอย่างน้อย 1 สาขาก่อนถึงจะนำเข้าได้
          </p>
        )}
      </div>

      {/* error */}
      {error && (
        <div className="rounded-2xl border-2 border-[var(--ch-danger)] bg-[var(--ch-danger-bg,#fef2f2)] p-4 text-sm text-[var(--ch-danger)] flex items-start gap-2 animate-fade-up">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">ทำรายการไม่สำเร็จ</p>
            <p className="mt-0.5">{error}</p>
          </div>
          <button onClick={reset} className="underline text-xs shrink-0">
            ลองใหม่
          </button>
        </div>
      )}

      {/* preview */}
      {preview && (
        <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-5 animate-fade-up space-y-4">
          <div className="flex items-center gap-2 font-bold text-[var(--ch-text)]">
            <Fuel className="size-4 text-[var(--ch-brand)]" />
            ตรวจก่อนนำเข้า · {preview.dateFrom} → {preview.dateTo}
          </div>

          <div className="rounded-xl bg-[var(--ch-bg-2)] px-3 py-2 text-sm text-[var(--ch-text)] flex items-center justify-between">
            <span>
              {preview.summary.branches} สาขา · รวมยอดขาย
            </span>
            <span className="font-extrabold ch-tnum text-[var(--ch-brand)]">
              {baht(preview.summary.baht)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="เพิ่มใหม่" value={preview.summary.new} tone="brand" />
            <Stat label="เหมือนเดิม" value={preview.summary.same} tone="muted" />
            <Stat label="เปลี่ยนแปลง" value={preview.summary.changed} tone="amber" />
          </div>

          {preview.unmapped.length > 0 && (
            <div className="rounded-xl border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-sm text-[#92400e]">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="size-4" /> ข้าม{" "}
                {preview.summary.unmappedDays} วัน จากสาขาที่ยังไม่จับคู่
              </div>
              <div className="mt-1 text-xs">
                รหัสสาขา:{" "}
                {preview.unmapped
                  .map((u) => `${u.steId} (${u.days} วัน)`)
                  .join(" · ")}{" "}
                — จับคู่ก่อนถึงจะนำเข้าได้
              </div>
            </div>
          )}

          {preview.excluded.length > 0 && (
            <div className="rounded-xl bg-[var(--ch-bg-2)] px-3 py-2 text-xs text-[var(--ch-text-2)]">
              ข้ามรหัสนอกลิสต์ 20 สาขา:{" "}
              {preview.excluded
                .map((u) => `${u.steId} (${baht(u.totalSales)})`)
                .join(" · ")}{" "}
              — ไม่นำเข้า (กันนับซ้ำ)
            </div>
          )}

          {preview.reconFlags > 0 && (
            <div className="rounded-xl bg-[var(--ch-bg-2)] px-3 py-2 text-xs text-[var(--ch-text-2)] flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-[#b45309]" />
              {preview.reconFlags} วันที่ยอดขายกับผลรวมวิธีจ่ายต่างกันเกิน ฿5
              (ปกติต่างเล็กน้อยจากส่วนลด/ทดสอบหัวจ่าย)
            </div>
          )}

          {preview.changedSample.length > 0 && (
            <details className="text-xs text-[var(--ch-text-2)]">
              <summary className="cursor-pointer">
                ตัวอย่างที่เปลี่ยนแปลง {preview.summary.changed} วัน
              </summary>
              <ul className="mt-1 space-y-0.5">
                {preview.changedSample.map((c, i) => (
                  <li key={i}>
                    {c.reportDate} · {c.branchName}: {baht(c.old ?? 0)} →{" "}
                    {baht(c.new)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={runCommit}
              disabled={busy !== null || preview.summary.new + preview.summary.changed === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold disabled:opacity-60"
            >
              {busy === "commit" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              ยืนยันนำเข้า {preview.summary.new + preview.summary.changed} วัน
            </button>
            <button
              onClick={reset}
              disabled={busy !== null}
              className="rounded-xl border border-[var(--ch-border)] px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "muted" | "amber";
}) {
  const color =
    tone === "brand"
      ? "text-[var(--ch-brand)]"
      : tone === "amber"
        ? "text-[#a16207]"
        : "text-[var(--ch-text-2)]";
  return (
    <div className="rounded-xl border border-[var(--ch-border)] py-2">
      <div className={"text-2xl font-extrabold ch-tnum " + color}>{value}</div>
      <div className="text-[11px] text-[var(--ch-text-2)]">{label}</div>
    </div>
  );
}
