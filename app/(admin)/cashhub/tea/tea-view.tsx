"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { formatBaht } from "@/lib/utils/format";
import type { SavedTeaDay } from "@/lib/cashhub/tea-data";
import { parseTeaPos, type TeaPosRow } from "@/lib/cashhub/tea-parse";

type BranchMeta = { code: string; label: string; brand: string };

type Props = {
  month: string;
  from: string;
  to: string;
  branches: BranchMeta[];
  savedDays: SavedTeaDay[];
  canPull: boolean;
  initialView: "matrix" | "branch";
  initialBranch: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shortLabel = (b: BranchMeta) => b.label.replace(b.brand, "").trim() || b.label;
const matchBadge = (s: string | null) => {
  switch (s) {
    case "match":
      return { text: "✅ ตรง", cls: "bg-emerald-50 text-emerald-700" };
    case "mismatch":
      return { text: "⚠️ ไม่ตรง", cls: "bg-red-50 text-red-700" };
    case "no_iv":
      return { text: "⚪ ไม่มี IV", cls: "bg-amber-50 text-amber-700" };
    case "no_pos":
      return { text: "— รอ POS", cls: "bg-zinc-100 text-zinc-500" };
    default:
      return { text: "—", cls: "bg-zinc-100 text-zinc-400" };
  }
};

export function TeaView({
  month,
  from,
  to,
  branches,
  savedDays,
  canPull,
  initialView,
  initialBranch,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<"matrix" | "branch">(initialView);
  const [branch, setBranch] = useState(initialBranch);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── นำเข้า POS Foodstory ──
  const [pending, setPending] = useState<{
    fileName: string;
    storeLabel: string | null;
    detected: string | null;
    rows: TeaPosRow[];
  } | null>(null);
  const [importBranch, setImportBranch] = useState("");
  const [importing, setImporting] = useState(false);

  // index: code|date -> day
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
          // ถ้าโดน rate-limit ให้พักนานขึ้นก่อนไปต่อ
          if ((data.error ?? "").includes("rate-limit")) await sleep(4000);
        } else {
          totalIv += data.ivCount ?? 0;
        }
      } catch {
        failed++;
      }
      if (i < branches.length - 1) await sleep(1800); // throttle TRCloud
    }
    setProgress(null);
    setBusy(false);
    if (failed === 0)
      setMsg({ kind: "ok", text: `ดึงครบ ${branches.length} สาขา · พบ IV รวม ${totalIv} ใบ` });
    else
      setMsg({
        kind: "err",
        text: `ดึงเสร็จ — สำเร็จ ${branches.length - failed}/${branches.length} สาขา (บางสาขาติด rate-limit ลองกดอีกครั้งใน 1–2 นาที)`,
      });
    router.refresh();
  }, [branches, from, to, router]);

  const exportXlsx = useCallback(() => {
    if (view === "matrix") {
      const head = ["วันที่", ...branches.map((b) => shortLabel(b)), "รวมวัน"];
      const aoa: (string | number)[][] = [head];
      const colTot = new Array(branches.length).fill(0);
      let grand = 0;
      for (const date of days) {
        let rowTot = 0;
        const cells = branches.map((b, ci) => {
          const d = dayMap.get(`${b.code}|${date}`);
          const v = d?.iv_gross ?? null;
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
    } else {
      const b = branches.find((x) => x.code === branch);
      const head = ["วันที่", "IV เลขที่", "ยอดขาย (รวม VAT)", "ก่อน VAT", "VAT", "POS Foodstory", "เทียบ"];
      const rows = days.map((date) => {
        const d = dayMap.get(`${branch}|${date}`);
        return [
          date,
          d?.iv_doc_no ?? "",
          d?.iv_gross ?? "",
          d?.iv_total ?? "",
          d?.iv_vat ?? "",
          d?.pos_gross ?? "",
          matchBadge(d?.match_state ?? null).text,
        ];
      });
      const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
      ws["!cols"] = head.map((h) => ({ wch: Math.max(10, String(h).length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, b ? shortLabel(b) : "สาขา");
      XLSX.writeFile(wb, `tea-${b ? shortLabel(b) : branch}-${month}.xlsx`);
    }
  }, [view, branches, branch, days, dayMap, month]);

  // ── เลือกไฟล์ Foodstory → parse ฝั่ง client → เด้ง panel ยืนยัน ──
  const onPickFile = useCallback(async (file: File) => {
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: "",
      }) as unknown[][];
      const res = parseTeaPos(matrix);
      if (res.error) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      setPending({
        fileName: file.name,
        storeLabel: res.storeLabel,
        detected: res.detectedBranchCode,
        rows: res.rows,
      });
      setImportBranch(res.detectedBranchCode ?? "");
    } catch {
      setMsg({ kind: "err", text: "อ่านไฟล์ไม่สำเร็จ — รองรับ .xlsx / .csv" });
    }
  }, []);

  // diff เทียบ POS เดิมในระบบ (ก่อนเขียนทับ) — pool-csv-import-must-diff-before-write
  const importDiff = useMemo(() => {
    if (!pending || !importBranch) return null;
    let neu = 0;
    let changed = 0;
    let same = 0;
    for (const r of pending.rows) {
      const prev = dayMap.get(`${importBranch}|${r.date}`)?.pos_gross ?? null;
      if (prev == null) neu++;
      else if (Math.abs(prev - r.gross) >= 0.01) changed++;
      else same++;
    }
    const total = pending.rows.reduce((s, r) => s + r.gross, 0);
    return { neu, changed, same, total, days: pending.rows.length };
  }, [pending, importBranch, dayMap]);

  const confirmImport = useCallback(async () => {
    if (!pending || !importBranch) return;
    setImporting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cashhub/tea/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchCode: importBranch,
          fileName: pending.fileName,
          rows: pending.rows.map((r) => ({ date: r.date, gross: r.gross })),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        saved?: number;
        matched?: number;
        mismatch?: number;
        noIv?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setMsg({ kind: "err", text: data.error ?? "นำเข้าไม่สำเร็จ" });
      } else {
        const bl = branches.find((b) => b.code === importBranch)?.label ?? importBranch;
        setMsg({
          kind: "ok",
          text: `นำเข้า POS ${bl} ${data.saved} วัน · ✅ ตรง ${data.matched} · ⚠️ ไม่ตรง ${data.mismatch} · ⚪ ไม่มี IV ${data.noIv}`,
        });
        setPending(null);
        setImportBranch("");
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "นำเข้าไม่สำเร็จ" });
    } finally {
      setImporting(false);
    }
  }, [pending, importBranch, branches, router]);

  return (
    <div className="space-y-5">
      {/* controls */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="branch" value={branch} />
            <input
              type="month"
              name="month"
              aria-label="เลือกเดือน"
              title="เลือกเดือน"
              defaultValue={month}
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
            />
            <button type="submit" className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white">
              ดู
            </button>
          </form>

          <div className="grow" />

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
            <label className="h-10 inline-flex items-center rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50 cursor-pointer">
              ⬆ อัปไฟล์ Foodstory
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                  e.target.value = "";
                }}
              />
            </label>
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

        {/* panel ยืนยันนำเข้า POS Foodstory */}
        {pending && (
          <div className="rounded-2xl border border-[var(--ch-brand,#1e3aff)]/40 bg-[var(--ch-brand,#1e3aff)]/[0.03] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-zinc-800">นำเข้ายอด POS Foodstory มาเทียบ</div>
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setImportBranch("");
                }}
                className="text-sm text-zinc-400 hover:text-zinc-700"
              >
                ✕ ยกเลิก
              </button>
            </div>
            <div className="text-sm text-zinc-500">
              ไฟล์: <span className="font-medium text-zinc-700">{pending.fileName}</span>
              {pending.storeLabel && (
                <>
                  {" · "}ในไฟล์ระบุสาขา:{" "}
                  <span className="font-medium text-zinc-700">{pending.storeLabel}</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-600">นำเข้าเป็นสาขา:</span>
              <select
                value={importBranch}
                onChange={(e) => setImportBranch(e.target.value)}
                aria-label="เลือกสาขาที่จะนำเข้า"
                className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium"
              >
                <option value="">— เลือกสาขา —</option>
                {branches.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
              {pending.detected && importBranch === pending.detected && (
                <span className="text-xs text-emerald-600">✓ ระบบเดาสาขาให้จากชื่อในไฟล์</span>
              )}
              {!pending.detected && (
                <span className="text-xs text-amber-600">
                  เดาสาขาอัตโนมัติไม่ได้ — กรุณาเลือกเอง
                </span>
              )}
            </div>
            {importDiff && (
              <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2 text-sm text-zinc-600">
                พบ <b className="text-zinc-800">{importDiff.days}</b> วัน · ยอดรวม{" "}
                <b className="text-zinc-800">{formatBaht(importDiff.total)}</b>
                {" · "}ใหม่ <b className="text-emerald-700">{importDiff.neu}</b> · เปลี่ยน{" "}
                <b className="text-amber-700">{importDiff.changed}</b> · เหมือนเดิม{" "}
                {importDiff.same}
              </div>
            )}
            <button
              type="button"
              disabled={!importBranch || importing}
              onClick={confirmImport}
              className="h-10 rounded-xl bg-[var(--ch-brand,#1e3aff)] px-5 text-sm font-bold text-white disabled:opacity-40"
            >
              {importing ? "กำลังนำเข้า…" : "ยืนยันนำเข้า"}
            </button>
          </div>
        )}

        {/* view toggle */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
            <button
              type="button"
              onClick={() => setView("matrix")}
              className={`h-8 rounded-lg px-3 text-sm font-medium ${view === "matrix" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500"}`}
            >
              ตารางรวม (วันที่ × สาขา)
            </button>
            <button
              type="button"
              onClick={() => setView("branch")}
              className={`h-8 rounded-lg px-3 text-sm font-medium ${view === "branch" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500"}`}
            >
              รายสาขา
            </button>
          </div>
          {view === "branch" && (
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              aria-label="เลือกสาขา"
              title="เลือกสาขา"
              className="h-9 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
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
        <p className="text-xs text-zinc-500">
          IV ดึงจาก TRCloud (มีคนคีย์ไว้แล้ว 1 ใบ/วัน/สาขา) · กด &ldquo;ดึงยอดจาก TRCloud&rdquo;
          เพื่ออัปเดต · แล้วกด &ldquo;⬆ อัปไฟล์ Foodstory&rdquo; (รายงานปิดสิ้นวัน 1 สาขา/ไฟล์)
          เพื่อเทียบว่ายอดที่คีย์ตรงกับ POS จริงไหม
        </p>
      </div>

      {!hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          ยังไม่มีข้อมูลเดือนนี้ — กด <b>&ldquo;⟳ ดึงยอดจาก TRCloud&rdquo;</b> ด้านบนเพื่อดึง IV ทั้ง{" "}
          {branches.length} สาขา
        </div>
      ) : view === "matrix" ? (
        <MatrixTable branches={branches} days={days} dayMap={dayMap} />
      ) : (
        <BranchTable branchCode={branch} days={days} dayMap={dayMap} />
      )}
    </div>
  );
}

// ── ตารางรวม วันที่ × สาขา ──────────────────────────────────────────────
function MatrixTable({
  branches,
  days,
  dayMap,
}: {
  branches: BranchMeta[];
  days: string[];
  dayMap: Map<string, SavedTeaDay>;
}) {
  const colTot = branches.map((b) =>
    days.reduce((s, date) => s + (dayMap.get(`${b.code}|${date}`)?.iv_gross ?? 0), 0),
  );
  const grand = colTot.reduce((a, b) => a + b, 0);

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
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
              return { v, state: d?.match_state ?? null };
            });
            return (
              <tr key={date} className="hover:bg-zinc-50/60">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-zinc-700 border-b border-zinc-100">
                  {Number(date.slice(8, 10))}
                </td>
                {cells.map((c, i) => (
                  <td
                    key={i}
                    className={`px-3 py-1.5 text-right tabular-nums border-b border-zinc-100 ${
                      c.state === "mismatch"
                        ? "bg-red-50 text-red-700 font-semibold"
                        : c.state === "no_iv"
                          ? "bg-amber-50 text-amber-700"
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
  );
}

// ── ตารางรายสาขา ───────────────────────────────────────────────────────
function BranchTable({
  branchCode,
  days,
  dayMap,
}: {
  branchCode: string;
  days: string[];
  dayMap: Map<string, SavedTeaDay>;
}) {
  const rows = days.map((date) => dayMap.get(`${branchCode}|${date}`) ?? null);
  const totGross = rows.reduce((s, d) => s + (d?.iv_gross ?? 0), 0);
  const totBefore = rows.reduce((s, d) => s + (d?.iv_total ?? 0), 0);
  const totVat = rows.reduce((s, d) => s + (d?.iv_vat ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-zinc-50 text-zinc-600">
            <th className="px-3 py-2 text-left font-semibold border-b border-zinc-200">วันที่</th>
            <th className="px-3 py-2 text-left font-semibold border-b border-zinc-200">IV เลขที่</th>
            <th className="px-3 py-2 text-right font-semibold border-b border-zinc-200">ยอดขาย (รวม VAT)</th>
            <th className="px-3 py-2 text-right font-semibold border-b border-zinc-200">ก่อน VAT</th>
            <th className="px-3 py-2 text-right font-semibold border-b border-zinc-200">VAT</th>
            <th className="px-3 py-2 text-right font-semibold border-b border-zinc-200">POS Foodstory</th>
            <th className="px-3 py-2 text-center font-semibold border-b border-zinc-200">เทียบ</th>
          </tr>
        </thead>
        <tbody>
          {days.map((date, i) => {
            const d = rows[i];
            const badge = matchBadge(d?.match_state ?? null);
            return (
              <tr key={date} className="hover:bg-zinc-50/60">
                <td className="px-3 py-1.5 font-medium text-zinc-700 border-b border-zinc-100">
                  {Number(date.slice(8, 10))}
                </td>
                <td className="px-3 py-1.5 text-zinc-500 border-b border-zinc-100 whitespace-nowrap">
                  {d?.iv_doc_no ?? <span className="text-zinc-300">—</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium text-zinc-800 border-b border-zinc-100">
                  {d?.iv_gross != null ? formatBaht(d.iv_gross) : <span className="text-zinc-300">—</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500 border-b border-zinc-100">
                  {d?.iv_total != null ? d.iv_total.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500 border-b border-zinc-100">
                  {d?.iv_vat != null ? d.iv_vat.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400 border-b border-zinc-100">
                  {d?.pos_gross != null ? formatBaht(d.pos_gross) : "—"}
                </td>
                <td className="px-3 py-1.5 text-center border-b border-zinc-100">
                  <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                    {badge.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-100 font-bold text-zinc-800">
            <td className="px-3 py-2" colSpan={2}>
              รวมเดือน
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatBaht(totGross)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{totBefore.toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums">{totVat.toLocaleString()}</td>
            <td className="px-3 py-2" colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
