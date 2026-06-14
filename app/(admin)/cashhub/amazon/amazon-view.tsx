"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { formatBaht } from "@/lib/utils/format";
import { CVAR_LABEL } from "@/lib/cashhub/amazon-parse";
import type { SavedAmazonDay, ImportHistoryRow } from "@/lib/cashhub/amazon-data";

type Props = {
  storeCode: string;
  branchLabel: string;
  branchType: string | null;
  month: string;
  from: string;
  to: string;
  savedDays: SavedAmazonDay[];
  canSend: boolean;
  history: ImportHistoryRow[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AmazonView({
  storeCode,
  branchLabel,
  branchType,
  from,
  to,
  savedDays,
  canSend,
  history,
}: Props) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const upload = useCallback(async () => {
    if (!file) return;
    setBusy("upload");
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cashhub/amazon-import/preview", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        saved?: number;
        ivWarn?: string | null;
        error?: string;
      };
      if (!res.ok || data.error) {
        setMsg({ kind: "err", text: data.error ?? "อ่านไฟล์ไม่สำเร็จ" });
        return;
      }
      setMsg({
        kind: "ok",
        text: `เซฟ ${data.saved} วันแล้ว${data.ivWarn ? ` · (เทียบ TRCloud: ${data.ivWarn})` : " · เทียบกับ TRCloud ให้แล้ว"}`,
      });
      setFile(null);
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }, [file, router]);

  const refreshMatch = useCallback(async () => {
    setBusy("match");
    setMsg(null);
    try {
      const res = await fetch("/api/cashhub/amazon-import/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeCode, from, to }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        updated?: number;
        ivCount?: number;
        error?: string;
      };
      if (!res.ok || data.error)
        setMsg({ kind: "err", text: data.error ?? "เทียบไม่สำเร็จ" });
      else {
        setMsg({
          kind: "ok",
          text: `เทียบกับ TRCloud แล้ว · พบ IV ${data.ivCount} ใบ · อัปเดต ${data.updated} วัน`,
        });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }, [storeCode, from, to, router]);

  const createIv = useCallback(
    async (day: SavedAmazonDay) => {
      if (!window.confirm(`สร้างใบกำกับภาษีจริง วันที่ ${day.sales_date}\nยอด ${formatBaht(day.gross)}\n\nยืนยัน?`))
        return;
      setBusy(`push-${day.sales_date}`);
      setMsg(null);
      try {
        const res = await fetch("/api/cashhub/amazon-import/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeCode,
            day: {
              date: day.sales_date,
              gross: day.gross,
              total: day.total ?? 0,
              vat: day.vat ?? 0,
              cvars: day.channels ?? {},
              sumChannels: day.gross,
              balanced: day.balanced,
              blockReason: day.block_reason,
              unmapped: [],
            },
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          ivNo?: string;
          error?: string;
        };
        if (data.ok) {
          setMsg({ kind: "ok", text: `สร้าง IV ${data.ivNo} วันที่ ${day.sales_date} แล้ว` });
          router.refresh();
        } else setMsg({ kind: "err", text: `${day.sales_date}: ${data.error ?? "ล้มเหลว"}` });
      } catch {
        setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
      } finally {
        setBusy(null);
      }
    },
    [storeCode, router],
  );

  const createAllReady = useCallback(async () => {
    const ready = savedDays.filter(
      (d) => d.balanced && d.iv_status !== "posted" && d.match_state !== "match",
    );
    if (ready.length === 0) return;
    if (
      !window.confirm(
        `สร้างใบกำกับภาษีจริง ${ready.length} ใบ (วันที่ยังไม่มี IV)\nยอดรวม ${formatBaht(ready.reduce((s, d) => s + d.gross, 0))}\n\nยืนยัน?`,
      )
    )
      return;
    setBusy("push-all");
    for (const day of ready) {
      setMsg({ kind: "ok", text: `กำลังสร้าง ${day.sales_date}…` });
      try {
        await fetch("/api/cashhub/amazon-import/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeCode,
            day: {
              date: day.sales_date,
              gross: day.gross,
              total: day.total ?? 0,
              vat: day.vat ?? 0,
              cvars: day.channels ?? {},
              sumChannels: day.gross,
              balanced: day.balanced,
              blockReason: day.block_reason,
              unmapped: [],
            },
          }),
        });
      } catch {
        /* ต่อวันถัดไป */
      }
      await sleep(1300); // throttle 429
    }
    setBusy(null);
    setMsg({ kind: "ok", text: `สร้าง IV เสร็จ ${ready.length} วัน` });
    router.refresh();
  }, [savedDays, storeCode, router]);

  const exportXlsx = useCallback(() => {
    const cvarKeys = Array.from(
      new Set(savedDays.flatMap((d) => Object.keys(d.channels ?? {}))),
    ).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const head = [
      "วันที่",
      "ยอดขาย POS",
      "ก่อน VAT",
      "VAT",
      "IV เลขที่",
      "ยอด IV (TRC)",
      "ตรงกับ POS",
      "สถานะ",
      ...cvarKeys.map((k) => CVAR_LABEL[k] ?? k),
    ];
    const aoa: (string | number)[][] = [
      head,
      ...savedDays.map((d) => [
        d.sales_date,
        d.gross,
        d.total ?? "",
        d.vat ?? "",
        d.iv_doc_no ?? "",
        d.iv_gross ?? "",
        d.match_state === "match"
          ? "ตรง"
          : d.match_state === "mismatch"
            ? "ไม่ตรง"
            : "ยังไม่มี IV",
        d.balanced ? "พร้อม" : `ติดปัญหา: ${d.block_reason ?? ""}`,
        ...cvarKeys.map((k) => d.channels?.[k] ?? ""),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map((h) => ({ wch: Math.max(10, String(h).length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Amazon");
    XLSX.writeFile(wb, `amazon-${branchLabel}-${from.slice(0, 7)}.xlsx`);
  }, [savedDays, branchLabel, from]);

  const stat = {
    days: savedDays.length,
    match: savedDays.filter((d) => d.match_state === "match").length,
    mismatch: savedDays.filter((d) => d.match_state === "mismatch").length,
    noIv: savedDays.filter((d) => d.balanced && d.match_state !== "match" && d.iv_status !== "posted").length,
    blocked: savedDays.filter((d) => !d.balanced).length,
  };

  return (
    <div className="space-y-5">
      {/* upload + actions */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium hover:bg-zinc-100">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            📄 {file ? file.name : "เลือกไฟล์ปิดกะ POS (.xlsx)"}
          </label>
          <button
            type="button"
            disabled={!file || busy !== null}
            onClick={upload}
            className="h-11 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy === "upload" ? "กำลังอ่าน + เซฟ…" : "อัปไฟล์ + เซฟ"}
          </button>
          <div className="grow" />
          <button
            type="button"
            disabled={busy !== null || savedDays.length === 0}
            onClick={refreshMatch}
            className="h-11 rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            {busy === "match" ? "กำลังเทียบ…" : "🔄 เทียบกับ TRCloud"}
          </button>
          <button
            type="button"
            disabled={savedDays.length === 0}
            onClick={exportXlsx}
            className="h-11 rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            ⬇ ดาวน์โหลด Excel
          </button>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="h-11 rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50"
            >
              🕘 ประวัติการอัป ({history.length})
            </button>
          )}
        </div>
        {showHistory && (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-500">
              ประวัติการนำเข้าไฟล์
            </div>
            <div className="space-y-1">
              {history.map((h, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-600"
                >
                  <span className="font-medium text-zinc-700">
                    {new Date(h.at).toLocaleString("th-TH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  <span>· {h.days} วัน</span>
                  {h.storeCode && <span>· สาขา {h.storeCode}</span>}
                  {h.file && <span className="text-zinc-400">· {h.file}</span>}
                  <span className="text-zinc-400">· โดย {h.by}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          {branchType ? `สูตรบัญชี: ${branchType} · ` : ""}อัปแล้วเซฟถาวร · กด&ldquo;เทียบกับ
          TRCloud&rdquo; เพื่ออัปเดตสถานะว่าที่คีย์ตรงกับ POS ไหม
        </p>
        {msg && (
          <div
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>

      {savedDays.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          ยังไม่มีข้อมูลเดือนนี้ — อัปไฟล์ปิดกะ POS ด้านบนเพื่อเริ่ม
        </div>
      ) : (
        <>
          {/* แจ้งเตือนยอดไม่ตรง / ติดปัญหา */}
          {(stat.mismatch > 0 || stat.blocked > 0) && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <div className="font-bold text-red-700">⚠️ พบรายการที่ต้องตรวจสอบ</div>
              <ul className="mt-1 text-sm text-red-700 space-y-0.5">
                {stat.mismatch > 0 && (
                  <li>
                    • <b>{stat.mismatch} วัน</b> ยอดใน TRCloud <b>ไม่ตรง</b>กับยอด POS —{" "}
                    {savedDays
                      .filter((d) => d.match_state === "mismatch")
                      .map((d) => d.sales_date.slice(5))
                      .join(", ")}
                  </li>
                )}
                {stat.blocked > 0 && (
                  <li>
                    • <b>{stat.blocked} วัน</b> ข้อมูล POS ไม่ครบ/ปิดกะไม่เสร็จ (ยังคีย์ IV ไม่ได้)
                  </li>
                )}
              </ul>
              <div className="mt-1.5 text-xs text-red-600">
                ตรวจสอบให้ถูกต้องก่อน — วันที่ยอดไม่ตรงควรแก้ที่ต้นทาง (POS/TRCloud) ไม่ใช่สร้างทับ
              </div>
            </div>
          )}

          {/* summary */}
          <div className="flex flex-wrap gap-2">
            <Stat n={stat.days} label="วันทั้งหมด" />
            <Stat n={stat.match} label="ตรงกับ TRC" tone="ok" />
            <Stat n={stat.mismatch} label="ไม่ตรง" tone="warn" />
            <Stat n={stat.noIv} label="ยังไม่มี IV" tone="info" />
            <Stat n={stat.blocked} label="ติดปัญหา" tone="warn" />
            {stat.noIv > 0 && canSend && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={createAllReady}
                className="ml-auto h-11 self-center rounded-xl bg-[var(--ch-brand,#1e3aff)] px-5 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy === "push-all" ? "กำลังสร้าง…" : `✓ สร้าง IV ที่ยังไม่มี (${stat.noIv} วัน)`}
              </button>
            )}
            {stat.noIv > 0 && !canSend && (
              <span className="ml-auto self-center text-xs text-zinc-400">
                🔒 เฉพาะ super_admin สร้าง IV ได้
              </span>
            )}
          </div>

          {/* excel grid */}
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                  <th className="p-3">วันที่</th>
                  <th className="p-3 text-right">ยอดขาย POS</th>
                  <th className="p-3 text-right">ก่อน VAT</th>
                  <th className="p-3 text-right">VAT</th>
                  <th className="p-3">IV (TRCloud)</th>
                  <th className="p-3 text-right">ยอด IV</th>
                  <th className="p-3">ตรงกับ POS?</th>
                  <th className="p-3">ช่องทาง</th>
                  <th className="p-3">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {savedDays.map((d) => (
                  <tr
                    key={d.sales_date}
                    className={
                      "border-b border-zinc-100 align-top " +
                      (d.match_state === "mismatch"
                        ? "bg-red-50/60"
                        : !d.balanced
                          ? "bg-amber-50/50"
                          : "")
                    }
                  >
                    <td className="p-3 font-medium text-zinc-700">{d.sales_date}</td>
                    <td className="p-3 text-right font-semibold">{formatBaht(d.gross)}</td>
                    <td className="p-3 text-right text-zinc-500">
                      {d.total != null ? formatBaht(d.total) : "—"}
                    </td>
                    <td className="p-3 text-right text-zinc-500">
                      {d.vat != null ? formatBaht(d.vat) : "—"}
                    </td>
                    <td className="p-3 text-xs text-zinc-600">{d.iv_doc_no ?? "—"}</td>
                    <td className="p-3 text-right text-zinc-500">
                      {d.iv_gross != null ? formatBaht(d.iv_gross) : "—"}
                    </td>
                    <td className="p-3">
                      <MatchBadge day={d} />
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(d.channels ?? {}).map(([k, v]) => (
                          <span
                            key={k}
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600"
                          >
                            {CVAR_LABEL[k] ?? k} {Number(v).toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      {!d.balanced ? (
                        <span className="text-xs text-amber-600" title={d.block_reason ?? ""}>
                          ⚠️ {d.block_reason}
                        </span>
                      ) : d.match_state === "match" || d.iv_status === "posted" ? (
                        <span className="text-xs text-emerald-600">✓ มีแล้ว</span>
                      ) : canSend ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => createIv(d)}
                          className="rounded-lg bg-[var(--ch-brand,#1e3aff)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          {busy === `push-${d.sales_date}` ? "กำลังสร้าง…" : "ส่งเข้า TRCloud"}
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400">🔒 super_admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MatchBadge({ day }: { day: SavedAmazonDay }) {
  if (day.match_state === "match")
    return <span className="text-xs font-medium text-emerald-600">✅ ตรง</span>;
  if (day.match_state === "mismatch") {
    const diff = (day.iv_gross ?? 0) - day.gross;
    return (
      <span className="text-xs font-medium text-red-600">
        ⚠️ ต่าง {diff > 0 ? "+" : ""}
        {formatBaht(diff)}
      </span>
    );
  }
  return <span className="text-xs text-zinc-400">⚪ ยังไม่เทียบ/ไม่มี IV</span>;
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
    <div className="rounded-xl bg-white border border-zinc-200 px-4 py-2 text-center">
      <div className={`text-lg font-bold ${c}`}>{n}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
