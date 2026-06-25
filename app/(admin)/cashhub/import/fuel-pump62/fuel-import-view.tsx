"use client";

import { useRef, useState } from "react";
import {
  Download,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  RotateCcw,
} from "lucide-react";

type Mode = "pull" | "upload";

interface MonthPreview {
  tab: string;
  label: string;
  days: number;
  rows: number;
  parsedTotal: number;
  sheetTotal: number | null;
  summaryMatches: boolean | null;
}
interface Preview {
  ok: true;
  mode: Mode;
  summary: { total: number; new: number; same: number; changed: number };
  months: MonthPreview[];
  flaggedCount: number;
  changedSample: Array<{ date: string; shift: string; old: number; new: number }>;
  warnings: string[];
}
interface CommitResult {
  ok: true;
  created: number;
  updated: number;
  flagged: number;
  total: number;
}

const baht = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export function FuelImportView() {
  const [busy, setBusy] = useState<null | "preview" | "commit">(null);
  const [mode, setMode] = useState<Mode>("pull");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function buildForm(m: Mode, f: File | null): FormData {
    const fd = new FormData();
    fd.set("mode", m);
    fd.set("latest", "2");
    if (m === "upload" && f) fd.set("file", f);
    return fd;
  }

  async function runPreview(m: Mode, f: File | null) {
    setBusy("preview");
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const res = await fetch("/api/cashhub/fuel-import/preview", {
        method: "POST",
        body: buildForm(m, f),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ดึงข้อมูลไม่สำเร็จ");
      } else {
        setMode(m);
        setFile(f);
        setPreview(data as Preview);
      }
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
      const res = await fetch("/api/cashhub/fuel-import", {
        method: "POST",
        body: buildForm(mode, file),
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

  // ---- success state ----
  if (result) {
    return (
      <div className="rounded-2xl border-2 border-[var(--ch-ok)] bg-[var(--ch-ok-bg,#ecfdf5)] p-5 animate-fade-up">
        <div className="flex items-center gap-2 text-[var(--ch-ok)] font-bold text-lg">
          <CheckCircle2 className="size-5" /> นำเข้าสำเร็จ
        </div>
        <ul className="mt-3 text-sm text-[var(--ch-text)] space-y-1">
          <li>• เพิ่มใหม่ {result.created} แถว · อัปเดต {result.updated} แถว (รวม {result.total})</li>
          <li>
            • พบ <strong>{result.flagged}</strong> แถวที่ต้องตรวจ (ส่วนต่าง/รอเงินเข้า/ผิดปกติ)
          </li>
        </ul>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <a
            href="/cashhub/fuel-pump62"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold"
          >
            ไปหน้าบริหารยอดขาย →
          </a>
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--ch-border)] px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold"
          >
            <RotateCcw className="size-3.5" /> นำเข้าใหม่
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* entry actions */}
      {!preview && (
        <div className="grid sm:grid-cols-2 gap-3 animate-fade-up">
          <button
            onClick={() => runPreview("pull", null)}
            disabled={busy !== null}
            className="rounded-2xl border-2 border-[var(--ch-brand)] bg-[var(--ch-brand-50,#eef1ff)] p-5 text-left transition-all hover:shadow-sm disabled:opacity-60"
          >
            <div className="flex items-center gap-2 text-[var(--ch-brand)] font-bold">
              {busy === "preview" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Download className="size-5" />
              )}
              ดึงข้อมูลล่าสุด
            </div>
            <p className="text-xs text-[var(--ch-text-2)] mt-1.5">
              โหลดจากชีต Google โดยตรง (2 เดือนล่าสุด) · ไม่ต้องล็อกอิน
            </p>
          </button>

          <label className="rounded-2xl border-2 border-dashed border-[var(--ch-border)] p-5 cursor-pointer transition-all hover:border-[var(--ch-brand)] disabled:opacity-60">
            <div className="flex items-center gap-2 font-bold text-[var(--ch-text)]">
              <Upload className="size-5" /> อัปไฟล์เอง (.xlsx)
            </div>
            <p className="text-xs text-[var(--ch-text-2)] mt-1.5">
              ถ้าลิงก์มีปัญหา — ดาวน์โหลดไฟล์จากชีตแล้วเลือกที่นี่
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) runPreview("upload", f);
              }}
            />
          </label>
        </div>
      )}

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
            <FileSpreadsheet className="size-4 text-[var(--ch-brand)]" />
            ตรวจก่อนนำเข้า · {preview.mode === "pull" ? "จากลิงก์" : "จากไฟล์อัป"}
          </div>

          {/* monthly cross-check (the trust gate) */}
          <div className="space-y-2">
            {preview.months.map((m) => (
              <div
                key={m.tab}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm"
              >
                <span className="font-semibold">{m.label}</span>
                <span className="text-[var(--ch-text-2)]">
                  {m.days} วัน · {m.rows} แถว
                </span>
                <span className="ch-tnum">{baht(m.parsedTotal)}</span>
                {m.summaryMatches === true ? (
                  <span className="inline-flex items-center gap-1 text-[var(--ch-ok)] font-semibold">
                    <CheckCircle2 className="size-3.5" /> ตรงยอดท้ายชีต
                  </span>
                ) : m.summaryMatches === false && m.sheetTotal != null ? (
                  <span
                    className="inline-flex items-center gap-1 text-[#a16207] font-semibold"
                    title={`ผลรวมรายวัน ${baht(m.parsedTotal)} · ยอดท้ายชีต ${baht(m.sheetTotal)}`}
                  >
                    <AlertTriangle className="size-3.5" /> ต่างยอดท้ายชีต{" "}
                    {baht(Math.abs(m.parsedTotal - m.sheetTotal))} — ควรตรวจชีต
                  </span>
                ) : (
                  <span className="text-[var(--ch-text-2)] text-xs">
                    (เทียบยอดท้ายชีตไม่ได้)
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* counts */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="เพิ่มใหม่" value={preview.summary.new} tone="brand" />
            <Stat label="เหมือนเดิม" value={preview.summary.same} tone="muted" />
            <Stat label="เปลี่ยนแปลง" value={preview.summary.changed} tone="amber" />
          </div>

          {preview.flaggedCount > 0 && (
            <div className="rounded-xl bg-[var(--ch-bg-2)] px-3 py-2 text-sm text-[var(--ch-text)] flex items-center gap-2">
              <AlertTriangle className="size-4 text-[var(--ch-danger)]" />
              พบ <strong>{preview.flaggedCount}</strong> แถวที่ต้องตรวจ —
              ดูรายละเอียดในหน้าบริหารหลังนำเข้า
            </div>
          )}

          {preview.warnings.length > 0 && (
            <details className="text-xs text-[var(--ch-text-2)]">
              <summary className="cursor-pointer">
                ข้อสังเกต {preview.warnings.length} รายการ
              </summary>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={runCommit}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 min-h-[44px] w-full sm:w-auto text-sm font-semibold disabled:opacity-60"
            >
              {busy === "commit" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              ยืนยันนำเข้า {preview.summary.total} แถว
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
