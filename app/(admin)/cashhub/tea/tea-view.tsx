"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import type { SavedTeaDay, TeaImportHistoryRow } from "@/lib/cashhub/tea-data";
import { computeTeaSettlement, type TeaChannelConfig } from "@/lib/cashhub/tea-channels";
import type { TeaReconcileCell } from "@/lib/cashhub/tea-settlement-data";
import { parseTeaPos, csvToMatrix, type TeaPosBranch } from "@/lib/cashhub/tea-parse";
import { TeaExcelGrid } from "./tea-excel-grid";
import { TeaReconcilePanel } from "./tea-reconcile-panel";

type BranchMeta = { code: string; label: string; brand: string };

type Props = {
  month: string;
  from: string;
  to: string;
  branches: BranchMeta[];
  savedDays: SavedTeaDay[];
  canPull: boolean;
  canConfig: boolean;
  channelConfigs: TeaChannelConfig[];
  reconStatus: Record<string, TeaReconcileCell>;
  importHistory: TeaImportHistoryRow[];
  initialView: "matrix" | "branch";
  initialBranch: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shortLabel = (b: BranchMeta) => b.label.replace(b.brand, "").trim() || b.label;
const fmtDateTime = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function TeaView({
  month,
  from,
  to,
  branches,
  savedDays,
  canPull,
  canConfig,
  channelConfigs,
  reconStatus,
  importHistory,
  initialView,
  initialBranch,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<"matrix" | "branch">(initialView);
  const [branch, setBranch] = useState(initialBranch);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── นำเข้า POS Foodstory (หลายสาขา/ไฟล์) ──
  const [pending, setPending] = useState<{
    fileName: string;
    branches: TeaPosBranch[];
    reportType?: "summary" | "detail" | "eod";
  } | null>(null);
  const [picks, setPicks] = useState<string[]>([]); // picks[i] = branchCode ของ section i
  const [importing, setImporting] = useState(false);
  const [reading, setReading] = useState(false); // กำลังอ่าน/แปลงไฟล์ (ไฟล์ใหญ่ใช้เวลา)
  const [showHistory, setShowHistory] = useState(false);

  const dayMap = useMemo(() => {
    const m = new Map<string, SavedTeaDay>();
    for (const d of savedDays) m.set(`${d.branch_code}|${d.sales_date}`, d);
    return m;
  }, [savedDays]);

  const days = useMemo(() => {
    const last = Number(to.slice(8, 10));
    const ym = from.slice(0, 8); // "2026-04-"
    return Array.from({ length: last }, (_, i) => `${ym}${String(i + 1).padStart(2, "0")}`);
  }, [from, to]);

  const hasAnyData = savedDays.length > 0;

  // ── ดึงยอดจาก TRCloud ทีละสาขา (หน่วงเวลา กัน 429) ──
  const pullAll = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    let totalIv = 0;
    let failed = 0;
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      setProgress(`กำลังดึง ${i + 1}/${branches.length} · ${b.label}…`);
      try {
        const res = await fetch("/api/cashhub/tea/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchCode: b.code, from, to }),
        });
        const data = (await res.json()) as { ok?: boolean; ivCount?: number; error?: string };
        if (!res.ok || data.error) {
          failed++;
          setMsg({ kind: "err", text: `${b.label}: ${data.error ?? "ดึงไม่สำเร็จ"}` });
          if ((data.error ?? "").includes("rate-limit")) await sleep(4000);
        } else {
          totalIv += data.ivCount ?? 0;
        }
      } catch {
        failed++;
      }
      if (i < branches.length - 1) await sleep(1800);
    }
    setProgress(null);
    setBusy(false);
    if (failed === 0)
      setMsg({ kind: "ok", text: `ดึงครบ ${branches.length} สาขา · พบ IV รวม ${totalIv} ใบ` });
    else
      setMsg({
        kind: "err",
        text: `ดึงเสร็จ — สำเร็จ ${branches.length - failed}/${branches.length} สาขา (บางสาขาติด rate-limit ลองอีกครั้งใน 1–2 นาที)`,
      });
    router.refresh();
  }, [branches, from, to, router]);

  const exportXlsx = useCallback(() => {
    const head = ["วันที่", ...branches.map((b) => shortLabel(b)), "รวมวัน"];
    const aoa: (string | number)[][] = [head];
    const colTot = new Array(branches.length).fill(0);
    let grand = 0;
    for (const date of days) {
      let rowTot = 0;
      const cells = branches.map((b, ci) => {
        const v = dayMap.get(`${b.code}|${date}`)?.iv_gross ?? null;
        if (v != null) {
          rowTot += v;
          colTot[ci] += v;
        }
        return v ?? "";
      });
      grand += rowTot;
      aoa.push([Number(date.slice(8, 10)), ...cells, rowTot]);
    }
    aoa.push(["รวม", ...colTot, grand]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map((h) => ({ wch: Math.max(10, String(h).length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ยอดขายรวม");
    XLSX.writeFile(wb, `tea-ยอดรวม-${month}.xlsx`);
  }, [branches, days, dayMap, month]);

  // ── เลือกไฟล์ Foodstory → parse ฝั่ง client (หลายสาขา) → เด้ง panel ยืนยัน ──
  const onPickFile = useCallback(async (file: File) => {
    setMsg(null);
    setReading(true);
    // ปล่อยให้ UI วาดสถานะ "กำลังอ่าน…" ก่อน (การ parse ฝั่ง client เป็น sync — ไฟล์ใหญ่ค้างจอชั่วคราว)
    await sleep(30);
    try {
      const buf = await file.arrayBuffer();
      let matrix: unknown[][];
      if (/\.csv$/i.test(file.name)) {
        // CSV → อ่าน UTF-8 + parse เอง (กัน XLSX แปลงวันที่ DD/MM/YYYY เพี้ยน)
        matrix = csvToMatrix(new TextDecoder("utf-8").decode(buf));
      } else {
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        matrix = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: false,
          defval: "",
        }) as unknown[][];
      }
      const res = parseTeaPos(matrix);
      if (res.error) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      // ❌ บล็อกรายงาน "รายละเอียดบิล" (ราคาสุทธิ = รวมรายเมนู) — ยอดไม่ตรงบิลจริง → ห้ามนำเข้า
      if (res.reportType === "detail") {
        setMsg({
          kind: "err",
          text: "❌ ไฟล์นี้เป็นรายงาน “ยอดขายแยกตามรายละเอียดบิล” — ใช้ไม่ได้ เพราะยอดรวมรายเมนูไม่ตรงกับยอดบิลจริง (TRCloud) · กรุณาอัป “รายงานสรุปยอดขายแยกตามบิล” แทน",
        });
        return;
      }
      if (res.warning) setMsg({ kind: "err", text: `⚠️ ${res.warning}` });
      setPending({ fileName: file.name, branches: res.branches, reportType: res.reportType });
      setPicks(res.branches.map((b) => b.detectedBranchCode ?? ""));
    } catch {
      setMsg({ kind: "err", text: "อ่านไฟล์ไม่สำเร็จ — รองรับ .xlsx / .csv (ลองบันทึกเป็น .csv แล้วอัปใหม่)" });
    } finally {
      setReading(false);
    }
  }, []);

  const setPick = (i: number, code: string) =>
    setPicks((p) => p.map((x, idx) => (idx === i ? code : x)));

  const confirmImport = useCallback(async () => {
    if (!pending) return;
    const payloadBranches = pending.branches
      .map((b, i) => ({
        branchCode: picks[i],
        rows: b.rows.map((r) => ({ date: r.date, gross: r.gross, channels: r.channels })),
      }))
      .filter((b) => b.branchCode && b.rows.length > 0);
    if (payloadBranches.length === 0) {
      setMsg({ kind: "err", text: "เลือกสาขาอย่างน้อย 1 สาขาก่อนนำเข้า" });
      return;
    }
    const skippedCount = pending.branches.length - payloadBranches.length;
    setImporting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cashhub/tea/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: pending.fileName, branches: payloadBranches }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        results?: { label: string; saved: number; mismatch: number }[];
        totals?: { saved: number; matched: number; mismatch: number; noIv: number };
        error?: string;
      };
      if (!res.ok || data.error) {
        setMsg({ kind: "err", text: data.error ?? "นำเข้าไม่สำเร็จ" });
      } else {
        const t = data.totals;
        const skipTxt = skippedCount > 0 ? ` · ข้าม ${skippedCount} สาขา (ยังไม่เลือก)` : "";
        setMsg({
          kind: "ok",
          text: `นำเข้า ${data.results?.length ?? 0} สาขา · รวม ${t?.saved ?? 0} วัน · ✅ ตรง ${t?.matched ?? 0} · ⚠️ ไม่ตรง ${t?.mismatch ?? 0} · ⚪ ไม่มี IV ${t?.noIv ?? 0}${skipTxt}`,
        });
        setPending(null);
        setPicks([]);
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "นำเข้าไม่สำเร็จ" });
    } finally {
      setImporting(false);
    }
  }, [pending, picks, router]);

  const branchByDate = useMemo(() => {
    const m = new Map<string, SavedTeaDay>();
    for (const d of savedDays) if (d.branch_code === branch) m.set(d.sales_date, d);
    return m;
  }, [savedDays, branch]);

  const branchDays = useMemo(
    () => savedDays.filter((d) => d.branch_code === branch),
    [savedDays, branch],
  );

  const branchLabel = branches.find((b) => b.code === branch)?.label ?? branch;

  // ตั้งค่าช่องทาง→บัญชีครบไหม (มีอย่างน้อย 1 ช่องที่เป็นเงินเข้าธนาคาร + ผูกบริษัท + บัญชี)
  const reconcileConfigured = useMemo(
    () => channelConfigs.some((c) => c.isSettle && c.companyId && c.bankAccountId),
    [channelConfigs],
  );

  // ── สรุปก่อนนำเข้า (กันซ้ำ): นับวันใหม่ vs วันที่จะเขียนทับ + จับว่าไฟล์ชื่อนี้เคยอัปแล้วไหม ──
  const importPreview = useMemo(() => {
    if (!pending) return null;
    let totalNew = 0;
    let totalOverwrite = 0;
    pending.branches.forEach((b, i) => {
      const pick = picks[i] ?? "";
      if (!pick) return;
      for (const r of b.rows) {
        const prev = dayMap.get(`${pick}|${r.date}`)?.pos_gross ?? null;
        if (prev == null) totalNew++;
        else totalOverwrite++;
      }
    });
    // จับไฟล์ซ้ำจากชื่อไฟล์ในประวัติการอัป (เตือนเฉย ๆ — ระบบเขียนทับต่อวันอยู่แล้ว ไม่บวกซ้ำ)
    const dup = importHistory.find((h) => h.file && h.file === pending.fileName) ?? null;
    return { totalNew, totalOverwrite, dup };
  }, [pending, picks, dayMap, importHistory]);

  return (
    <div className="space-y-5">
      {/* controls */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="branch" value={branch} />
            <input
              type="month"
              name="month"
              aria-label="เลือกเดือน"
              title="เลือกเดือน"
              defaultValue={month}
              className="h-10 grow sm:grow-0 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
            />
            <button type="submit" className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white">
              ดู
            </button>
          </form>

          <div className="hidden sm:block grow" />

          {canConfig && (
            <a
              href="/cashhub/tea/settings"
              className="h-10 inline-flex items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50"
            >
              ⚙ ตั้งค่าบัญชี (Reconcile)
            </a>
          )}
          {canPull && (
            <button
              type="button"
              disabled={busy}
              onClick={pullAll}
              className="h-10 rounded-xl bg-[var(--ch-brand,#1e3aff)] px-5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? progress ?? "กำลังดึง…" : "⟳ ดึงยอดจาก TRCloud"}
            </button>
          )}
          {canPull && (
            <label
              className={`h-10 inline-flex items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-medium ${reading ? "opacity-60 cursor-wait" : "hover:bg-zinc-50 cursor-pointer"}`}
            >
              {reading ? "⏳ กำลังอ่านไฟล์…" : "⬆ อัปไฟล์ Foodstory"}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={reading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {canPull && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className={`h-10 rounded-xl border px-4 text-sm font-medium ${showHistory ? "border-[var(--ch-brand,#1e3aff)] bg-[var(--ch-brand,#1e3aff)]/[0.06] text-[var(--ch-brand,#1e3aff)]" : "border-zinc-200 hover:bg-zinc-50"}`}
            >
              🕘 ประวัติการอัป
            </button>
          )}
          <button
            type="button"
            disabled={!hasAnyData}
            onClick={exportXlsx}
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            ⬇ Excel
          </button>
        </div>

        {/* panel ยืนยันนำเข้า POS Foodstory (หลายสาขา) */}
        {pending && (
          <div className="rounded-2xl border border-[var(--ch-brand,#1e3aff)]/40 bg-[var(--ch-brand,#1e3aff)]/[0.03] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-zinc-800">
                นำเข้ายอด POS Foodstory — พบ {pending.branches.length} สาขาในไฟล์
              </div>
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setPicks([]);
                }}
                className="text-sm text-zinc-400 hover:text-zinc-700"
              >
                ✕ ยกเลิก
              </button>
            </div>
            <div className="text-sm text-zinc-500">
              ไฟล์: <span className="font-medium text-zinc-700">{pending.fileName}</span>
            </div>

            {/* เตือนไฟล์ซ้ำ — ชื่อไฟล์นี้เคยอัปแล้ว */}
            {importPreview?.dup && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                🔁 <b>ไฟล์ชื่อนี้เคยอัปแล้ว</b> เมื่อ {fmtDateTime(importPreview.dup.at)} โดย{" "}
                {importPreview.dup.by} ({importPreview.dup.baht.toLocaleString()} ฿ ·{" "}
                {importPreview.dup.days} วัน) — อัปซ้ำได้ ระบบจะ<b>เขียนทับ ไม่บวกเพิ่ม</b>
              </div>
            )}

            {/* สรุปก่อนนำเข้า: วันใหม่ vs เขียนทับของเดิม */}
            {importPreview && (importPreview.totalNew > 0 || importPreview.totalOverwrite > 0) && (
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm">
                จะนำเข้า:{" "}
                <span className="font-semibold text-emerald-700">
                  {importPreview.totalNew} วันใหม่
                </span>
                {importPreview.totalOverwrite > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-amber-700">
                      เขียนทับของเดิม {importPreview.totalOverwrite} วัน
                    </span>{" "}
                    <span className="text-zinc-500">(แทนที่ค่าเดิม ไม่บวกซ้ำ)</span>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              {pending.branches.map((b, i) => {
                const pick = picks[i] ?? "";
                let neu = 0;
                let exist = 0;
                for (const r of b.rows) {
                  const prev = pick ? dayMap.get(`${pick}|${r.date}`)?.pos_gross ?? null : null;
                  if (prev == null) neu++;
                  else exist++;
                }
                const total = b.rows.reduce((s, r) => s + r.gross, 0);
                return (
                  <div
                    key={i}
                    className="rounded-xl bg-white border border-zinc-200 px-3 py-2.5 flex flex-wrap items-center gap-2"
                  >
                    <div className="w-full sm:w-auto sm:min-w-[180px] text-sm text-zinc-600">
                      ในไฟล์:{" "}
                      <span className="font-medium text-zinc-800">
                        {b.storeLabel ?? b.storeCode ?? "—"}
                      </span>
                    </div>
                    <span className="hidden sm:inline text-sm text-zinc-400">→</span>
                    <select
                      value={pick}
                      onChange={(e) => setPick(i, e.target.value)}
                      aria-label="เลือกสาขาที่จะนำเข้า"
                      className="h-9 w-full sm:w-auto rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium"
                    >
                      <option value="">— ข้าม (ไม่นำเข้า) —</option>
                      {branches.map((br) => (
                        <option key={br.code} value={br.code}>
                          {br.label}
                        </option>
                      ))}
                    </select>
                    {b.detectedBranchCode && pick === b.detectedBranchCode && (
                      <span className="text-xs text-emerald-600">✓ เดาให้</span>
                    )}
                    <div className="grow" />
                    <div className="text-xs text-zinc-500">
                      {b.rows.length} วัน · {total.toLocaleString()} ฿
                      {pick && (
                        <>
                          {" · "}ใหม่ {neu}
                          {exist > 0 && <span className="text-amber-700"> · เขียนทับ {exist}</span>}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              disabled={importing || picks.every((p) => !p)}
              onClick={confirmImport}
              className="h-11 w-full sm:w-auto rounded-xl bg-[var(--ch-brand,#1e3aff)] px-5 text-sm font-bold text-white disabled:opacity-40"
            >
              {importing ? "กำลังนำเข้า…" : "ยืนยันนำเข้าทุกสาขาที่เลือก"}
            </button>
          </div>
        )}

        {/* ประวัติการอัปไฟล์ Foodstory (toggle ด้วยปุ่ม 🕘 ประวัติการอัป) */}
        {showHistory && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-zinc-800">
                🕘 ประวัติการอัปไฟล์ {importHistory.length > 0 && `(${importHistory.length} ครั้งล่าสุด)`}
              </div>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="text-sm text-zinc-400 hover:text-zinc-700"
              >
                ✕ ปิด
              </button>
            </div>
            {importHistory.length === 0 ? (
              <div className="py-4 text-center text-sm text-zinc-400">
                ยังไม่มีประวัติการอัปไฟล์ — อัปไฟล์ Foodstory ครั้งแรกแล้วจะขึ้นที่นี่
              </div>
            ) : (
              <div className="space-y-2">
                {importHistory.map((h, i) => (
                  <div key={i} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-zinc-800">{fmtDateTime(h.at)}</span>
                      <span className="text-zinc-300">·</span>
                      <span className="text-zinc-600">โดย {h.by}</span>
                      <div className="grow" />
                      <span className="tabular-nums text-zinc-500">
                        {h.days} วัน · {h.baht.toLocaleString()} ฿
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                      {h.file && <span className="text-zinc-500">📄 {h.file}</span>}
                      <span className="text-emerald-600">✅ ตรง {h.matched}</span>
                      {h.mismatch > 0 && <span className="text-red-600">⚠️ ไม่ตรง {h.mismatch}</span>}
                      {h.noIv > 0 && <span className="text-amber-600">⚪ ยังไม่มี IV {h.noIv}</span>}
                    </div>
                    {h.branches.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.branches.map((b, j) => (
                          <span
                            key={j}
                            className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600"
                          >
                            {b.label} · {b.saved} วัน
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* view toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="inline-flex w-full sm:w-auto rounded-xl border border-zinc-200 bg-zinc-50 p-1">
            <button
              type="button"
              onClick={() => setView("matrix")}
              className={`h-8 flex-1 sm:flex-none rounded-lg px-3 text-sm font-medium ${view === "matrix" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500"}`}
            >
              ตารางรวม (วันที่ × สาขา)
            </button>
            <button
              type="button"
              onClick={() => setView("branch")}
              className={`h-8 flex-1 sm:flex-none rounded-lg px-3 text-sm font-medium ${view === "branch" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500"}`}
            >
              รายสาขา (Excel)
            </button>
          </div>
          {view === "branch" && (
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              aria-label="เลือกสาขา"
              title="เลือกสาขา"
              className="h-9 w-full sm:w-auto rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
            >
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {msg && (
          <div
            className={`rounded-xl px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
          >
            {msg.text}
          </div>
        )}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          📋 <b>ต้องใช้รายงาน &ldquo;สรุปยอดขายแยกตามบิล&rdquo;</b> จาก Foodstory เท่านั้น (ยอดต่อบิลจริง ·
          ตรงกับ TRCloud) — <b>ห้าม</b>ใช้รายงาน &ldquo;ยอดขายแยกตามรายละเอียดบิล&rdquo; (รวมรายเมนู ·
          ยอดไม่ตรง · ระบบจะบล็อกให้)
        </div>
        <p className="text-xs text-zinc-500">
          ดึง IV จาก TRCloud (คีย์ไว้แล้ว 1 ใบ/วัน/สาขา) → กด &ldquo;⬆ อัปไฟล์ Foodstory&rdquo;
          (รายงานสรุปยอดขายแยกตามบิล · ไฟล์เดียวมีหลายสาขาได้) → ดูทาน &ldquo;รายสาขา (Excel)&rdquo; ว่าตรง
          POS ไหม · ตั้งบัญชีต่อช่องทางที่ &ldquo;⚙ ตั้งค่าบัญชี&rdquo; เพื่อเตรียม reconcile
          {canConfig && (
            <>
              {" · "}
              <b>ส่งเข้ากระทบยอดธนาคาร</b> ทำที่แผง &ldquo;🏦 กระทบยอดธนาคาร&rdquo; ด้านล่าง → เลือกสาขา →
              ปุ่ม &ldquo;ส่งเข้าระบบบัญชี&rdquo;
            </>
          )}
        </p>
      </div>

      {/* แผงกระทบยอดธนาคาร — โชว์ทุกแท็บ (มีช่องเลือกสาขาในตัว) ให้หาเจอง่าย */}
      {canConfig && hasAnyData && (
        <TeaReconcilePanel
          branchCode={branch}
          branchLabel={branchLabel}
          month={month}
          configured={reconcileConfigured}
          canSend={canConfig}
          days={branchDays}
          configs={channelConfigs}
          status={reconStatus}
          branches={branches}
          onBranchChange={setBranch}
        />
      )}

      {!hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          ยังไม่มีข้อมูลเดือนนี้ — กด <b>&ldquo;⟳ ดึงยอดจาก TRCloud&rdquo;</b> ด้านบนเพื่อดึง IV ทั้ง{" "}
          {branches.length} สาขา
        </div>
      ) : view === "matrix" ? (
        <MatrixTable
          branches={branches}
          days={days}
          dayMap={dayMap}
          channelConfigs={channelConfigs}
          reconStatus={canConfig ? reconStatus : {}}
        />
      ) : (
        <TeaExcelGrid
          branchLabel={branchLabel}
          branchCode={branch}
          days={days}
          byDate={branchByDate}
          canSend={canConfig}
          reconStatus={canConfig ? reconStatus : {}}
        />
      )}
    </div>
  );
}

// ── ตารางรวม วันที่ × สาขา ──────────────────────────────────────────────
// สถานะกระทบยอดธนาคาร "รวมวัน" ของสาขาหนึ่ง — worst-case: ยังไม่ส่งแม้ 1 ช่องทาง > รอกระทบ > กระทบครบแล้ว
// (ไม่โชว์เขียว/สีรุ้งจนกว่าทุกช่องทางที่ต้องเข้าธนาคารวันนั้นกระทบยอดแล้วจริง — กันโชว์เกินจริง)
function teaDayReconState(
  d: SavedTeaDay | undefined,
  branchCode: string,
  date: string,
  configByCode: Map<string, TeaChannelConfig>,
  reconStatus: Record<string, TeaReconcileCell>,
): "reconciled" | "pending" | "unsent" | null {
  if (!d) return null;
  const { perChannel } = computeTeaSettlement(d.pos_channels ?? null, configByCode);
  let sawAny = false;
  let worst: "reconciled" | "pending" | "unsent" = "reconciled";
  for (const ch of perChannel) {
    if (!ch.settled || !(ch.net > 0)) continue;
    sawAny = true;
    const st = reconStatus[`tea:${branchCode}:${date}:${ch.code}`];
    const state = st ? (st.reconciled ? "reconciled" : "pending") : "unsent";
    if (state === "unsent") worst = "unsent";
    else if (state === "pending" && worst !== "unsent") worst = "pending";
  }
  return sawAny ? worst : null;
}

function MatrixTable({
  branches,
  days,
  dayMap,
  channelConfigs,
  reconStatus,
}: {
  branches: BranchMeta[];
  days: string[];
  dayMap: Map<string, SavedTeaDay>;
  channelConfigs: TeaChannelConfig[];
  reconStatus: Record<string, TeaReconcileCell>;
}) {
  const configByCode = useMemo(() => new Map(channelConfigs.map((c) => [c.code, c])), [channelConfigs]);
  const colTot = branches.map((b) =>
    days.reduce((s, date) => s + (dayMap.get(`${b.code}|${date}`)?.iv_gross ?? 0), 0),
  );
  const grand = colTot.reduce((a, b) => a + b, 0);

  return (
    <div>
      <p className="lg:hidden mb-1.5 text-xs" style={{ color: "var(--ch-text-3)" }}>
        ปัด ←→ เพื่อดูเพิ่ม
      </p>
      <div className="overflow-x-auto -mx-3 px-3 lg:mx-0 lg:px-0 rounded-2xl border border-zinc-200 bg-white">
        <table className="min-w-max lg:min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-zinc-50">
            <th className="sticky left-0 z-10 bg-zinc-50 px-3 py-2 text-left font-semibold text-zinc-600 border-b border-zinc-200">
              วันที่
            </th>
            {branches.map((b) => (
              <th
                key={b.code}
                className="px-3 py-2 text-right font-semibold text-zinc-600 border-b border-zinc-200 whitespace-nowrap"
                title={b.label}
              >
                {shortLabel(b)}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-bold text-zinc-800 border-b border-zinc-200 bg-zinc-100">
              รวมวัน
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((date) => {
            let rowTot = 0;
            const cells = branches.map((b) => {
              const d = dayMap.get(`${b.code}|${date}`);
              const v = d?.iv_gross ?? null;
              if (v != null) rowTot += v;
              return {
                v,
                state: d?.match_state ?? null,
                recon: teaDayReconState(d, b.code, date, configByCode, reconStatus),
              };
            });
            return (
              <tr key={date} className="hover:bg-zinc-50/60">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-zinc-700 border-b border-zinc-100">
                  {Number(date.slice(8, 10))}
                </td>
                {cells.map((c, i) => (
                  <td
                    key={i}
                    title={
                      c.recon === "reconciled"
                        ? "กระทบยอดธนาคารครบแล้ว"
                        : c.recon === "pending"
                          ? "ส่งเข้าระบบแล้ว · รอธนาคารมากระทบ"
                          : c.recon === "unsent"
                            ? "ยังไม่ส่งเข้ากระทบยอดธนาคาร"
                            : undefined
                    }
                    className={`px-3 py-1.5 text-right tabular-nums border-b border-zinc-100 ${
                      c.state === "mismatch"
                        ? "bg-red-50 text-red-700 font-semibold"
                        : c.state === "no_iv"
                          ? "bg-amber-50 text-amber-700"
                          : c.recon === "reconciled"
                            ? "cell-matched-iridescent"
                            : c.recon === "pending"
                              ? "bg-amber-50/40 text-amber-700"
                              : "text-zinc-700"
                    }`}
                  >
                    {c.v != null ? c.v.toLocaleString() : <span className="text-zinc-300">—</span>}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right tabular-nums font-bold text-zinc-900 border-b border-zinc-100 bg-zinc-50">
                  {rowTot.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-100 font-bold">
            <td className="sticky left-0 z-10 bg-zinc-100 px-3 py-2 text-zinc-800">รวม</td>
            {colTot.map((t, i) => (
              <td key={i} className="px-3 py-2 text-right tabular-nums text-zinc-800">
                {t.toLocaleString()}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums text-zinc-900 bg-zinc-200">
              {grand.toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}
