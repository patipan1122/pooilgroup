"use client";

import { useState, useCallback } from "react";
import { formatBaht } from "@/lib/utils/format";
import { CVAR_LABEL } from "@/lib/cashhub/amazon-parse";

type DayRow = {
  date: string;
  gross: number;
  total: number;
  vat: number;
  cvars: Record<string, number>;
  balanced: boolean;
  blockReason: string | null;
  alreadyKeyed: boolean;
};
type Preview = {
  store: { label: string | null; code: string | null };
  branch: { label: string; type: string; project: string };
  rows: DayRow[];
  ivWarn: string | null;
  summary: { days: number; ready: number; alreadyKeyed: number; blocked: number };
};
type PushState = Record<string, "idle" | "pushing" | "done" | "skip" | "fail">;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AmazonShell() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [push, setPush] = useState<PushState>({});
  const [pushResult, setPushResult] = useState<Record<string, string>>({});
  const [pushing, setPushing] = useState(false);

  const upload = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setPreview(null);
    setPush({});
    setPushResult({});
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cashhub/amazon-import/preview", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as Preview & { error?: string };
      if (!res.ok || data.error) {
        setErr(data.error ?? "อ่านไฟล์ไม่สำเร็จ");
        return;
      }
      setPreview(data);
      // default เลือกเฉพาะวันที่พร้อม + ยังไม่เคยคีย์
      setPicked(
        new Set(
          data.rows.filter((r) => r.balanced && !r.alreadyKeyed).map((r) => r.date),
        ),
      );
    } catch {
      setErr("เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [file]);

  const toggle = (date: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });

  const selectedRows = preview?.rows.filter((r) => picked.has(r.date)) ?? [];
  const selectedTotal = selectedRows.reduce((s, r) => s + r.gross, 0);

  const doPush = useCallback(async () => {
    if (!preview || selectedRows.length === 0) return;
    const ok = window.confirm(
      `จะสร้างใบกำกับภาษีจริง ${selectedRows.length} ใบ เข้า TRCloud\nยอดรวม ${formatBaht(selectedTotal)}\n\nยืนยัน?`,
    );
    if (!ok) return;
    setPushing(true);
    for (const row of selectedRows) {
      setPush((p) => ({ ...p, [row.date]: "pushing" }));
      try {
        const res = await fetch("/api/cashhub/amazon-import/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeCode: preview.store.code, day: row }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          ivNo?: string;
          duplicate?: boolean;
          error?: string;
        };
        if (data.ok) {
          setPush((p) => ({ ...p, [row.date]: data.duplicate ? "skip" : "done" }));
          setPushResult((p) => ({
            ...p,
            [row.date]: data.duplicate
              ? `มีอยู่แล้ว (${data.ivNo})`
              : `สร้างแล้ว ${data.ivNo}`,
          }));
        } else {
          setPush((p) => ({ ...p, [row.date]: "fail" }));
          setPushResult((p) => ({ ...p, [row.date]: data.error ?? "ล้มเหลว" }));
        }
      } catch {
        setPush((p) => ({ ...p, [row.date]: "fail" }));
        setPushResult((p) => ({ ...p, [row.date]: "เชื่อมต่อไม่สำเร็จ" }));
      }
      await sleep(1300); // throttle กัน TRCloud 429
    }
    setPushing(false);
  }, [preview, selectedRows, selectedTotal]);

  return (
    <div className="space-y-5">
      {/* upload */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium hover:bg-zinc-100">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setErr(null);
              }}
            />
            📄 {file ? file.name : "เลือกไฟล์ปิดกะ POS (.xlsx)"}
          </label>
          <button
            type="button"
            disabled={!file || busy}
            onClick={upload}
            className="h-11 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "กำลังอ่าน…" : "อ่านไฟล์ + ตรวจ"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          ดาวน์โหลด &ldquo;รายงานปิดกะและปิดสิ้นวัน&rdquo; จากระบบ POS Café Amazon (.xlsx)
          แล้วอัปที่นี่ · ระบบยังไม่สร้างอะไรจนกว่าจะกดยืนยัน
        </p>
        {err && (
          <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}
      </div>

      {preview && (
        <>
          {/* header info */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-zinc-800">
                  {preview.store.label ?? preview.branch.label}
                </div>
                <div className="text-xs text-zinc-500">
                  สูตรบัญชี: {preview.branch.type} · {preview.branch.project}
                </div>
              </div>
              <div className="flex gap-2 text-center text-xs">
                <Stat n={preview.summary.days} label="วันทั้งหมด" />
                <Stat n={preview.summary.ready} label="พร้อมสร้าง" tone="ok" />
                <Stat n={preview.summary.alreadyKeyed} label="คีย์แล้ว" tone="info" />
                <Stat n={preview.summary.blocked} label="ติดปัญหา" tone="warn" />
              </div>
            </div>
            {preview.ivWarn && (
              <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠️ เช็คใบซ้ำกับ TRCloud ไม่ได้: {preview.ivWarn} (ระบบยังกันซ้ำตอนสร้างจริงอีกชั้น)
              </div>
            )}
          </div>

          {/* review table */}
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                  <th className="p-3 w-8"></th>
                  <th className="p-3">วันที่</th>
                  <th className="p-3 text-right">ยอดขาย</th>
                  <th className="p-3 text-right">ก่อน VAT</th>
                  <th className="p-3 text-right">VAT 7%</th>
                  <th className="p-3">ช่องทาง</th>
                  <th className="p-3">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const st = push[r.date] ?? "idle";
                  const selectable = r.balanced && !r.alreadyKeyed;
                  return (
                    <tr key={r.date} className="border-b border-zinc-100 align-top">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          disabled={!selectable || pushing}
                          checked={picked.has(r.date)}
                          onChange={() => toggle(r.date)}
                          aria-label={`เลือก ${r.date}`}
                        />
                      </td>
                      <td className="p-3 font-medium text-zinc-700">{r.date}</td>
                      <td className="p-3 text-right font-semibold">
                        {formatBaht(r.gross)}
                      </td>
                      <td className="p-3 text-right text-zinc-500">{formatBaht(r.total)}</td>
                      <td className="p-3 text-right text-zinc-500">{formatBaht(r.vat)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(r.cvars).map(([k, v]) => (
                            <span
                              key={k}
                              className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600"
                            >
                              {CVAR_LABEL[k] ?? k} {v.toLocaleString()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <StatusCell
                          row={r}
                          pushState={st}
                          result={pushResult[r.date]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* push bar */}
          <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
            <div className="text-sm text-zinc-600">
              เลือก <b className="text-zinc-900">{selectedRows.length}</b> วัน · ยอดรวม{" "}
              <b className="text-zinc-900">{formatBaht(selectedTotal)}</b>
            </div>
            <button
              type="button"
              disabled={selectedRows.length === 0 || pushing}
              onClick={doPush}
              className="h-11 rounded-xl bg-[var(--ch-brand,#1e3aff)] px-6 text-sm font-bold text-white disabled:opacity-40"
            >
              {pushing ? "กำลังสร้าง IV…" : `✓ ยืนยันสร้าง IV (${selectedRows.length} ใบ)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "ok" | "info" | "warn";
}) {
  const c =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "info"
        ? "text-blue-600"
        : tone === "warn"
          ? "text-amber-600"
          : "text-zinc-700";
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-1.5">
      <div className={`text-lg font-bold ${c}`}>{n}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}

function StatusCell({
  row,
  pushState,
  result,
}: {
  row: DayRow;
  pushState: string;
  result?: string;
}) {
  if (pushState === "pushing")
    return <span className="text-xs text-blue-600">⏳ กำลังสร้าง…</span>;
  if (pushState === "done")
    return <span className="text-xs font-medium text-emerald-600">✅ {result}</span>;
  if (pushState === "skip")
    return <span className="text-xs text-blue-600">↩ {result}</span>;
  if (pushState === "fail")
    return <span className="text-xs text-red-600">❌ {result}</span>;
  if (row.alreadyKeyed)
    return <span className="text-xs text-blue-600">คีย์แล้วใน TRCloud</span>;
  if (!row.balanced)
    return (
      <span className="text-xs text-amber-600" title={row.blockReason ?? ""}>
        ⚠️ {row.blockReason}
      </span>
    );
  return <span className="text-xs text-emerald-600">พร้อมสร้าง</span>;
}
