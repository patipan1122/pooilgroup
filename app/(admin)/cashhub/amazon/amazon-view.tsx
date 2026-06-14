"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { formatBaht } from "@/lib/utils/format";
import { CVAR_LABEL } from "@/lib/cashhub/amazon-parse";
import type {
  SavedAmazonDay,
  ImportHistoryRow,
  ReconcileStatus,
} from "@/lib/cashhub/amazon-data";
import type { ChannelConfig } from "@/lib/cashhub/amazon-settlement";
import { AmazonExcelGrid } from "./amazon-excel-grid";

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
  configs: ChannelConfig[];
  reconcile: ReconcileStatus;
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
  configs,
  reconcile,
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
        body: JSON.stringify({ storeCode, storeLabel: branchLabel, from, to }),
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
            storeLabel: branchLabel,
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

  // ส่งเงินเข้าจริง (หลังหักค่าธรรมเนียม) ของเดือน → หน้ากระทบยอดธนาคาร (super_admin)
  const sendReconcile = useCallback(async () => {
    if (
      !window.confirm(
        "ส่งเงินเข้าจริง (เฉพาะช่องที่ตั้งค่าแล้ว หลังหักค่าธรรมเนียม) ของเดือนนี้ เข้าหน้ากระทบยอดธนาคาร?\n\nระบบจะกันรายการซ้ำให้ (ส่งซ้ำได้ ไม่เพิ่มซ้ำ)",
      )
    )
      return;
    setBusy("reconcile");
    setMsg(null);
    try {
      const res = await fetch("/api/cashhub/amazon-settlement/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeCode, storeLabel: branchLabel, from, to }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        skippedNoConfig?: number;
        error?: string;
      };
      if (!res.ok || data.error) setMsg({ kind: "err", text: data.error ?? "ส่งไม่สำเร็จ" });
      else
        setMsg({
          kind: "ok",
          text: `ส่งเข้า reconcile แล้ว ${data.inserted} รายการ${data.skippedNoConfig ? ` · ข้าม ${data.skippedNoConfig} (ยังไม่ตั้งบัญชี)` : ""} → ดูที่หน้ากระทบยอดธนาคาร`,
        });
    } catch {
      setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }, [storeCode, from, to]);

  // ⚠️ ส่งซ้ำ (ทดสอบ) — ข้าม dedup → ได้ใบกำกับซ้ำจริง · super_admin + พิมพ์ยืนยัน
  const forceSend = useCallback(
    async (day: SavedAmazonDay) => {
      const typed = window.prompt(
        `⚠️ ส่งซ้ำเข้า TRCloud — วันที่ ${day.sales_date} (ยอด ${formatBaht(day.gross)})\n\n` +
          `จะได้ใบกำกับภาษี "ซ้ำ" ในระบบจริง! (สำหรับทดสอบเท่านั้น — รายได้/VAT จะถูกนับเพิ่ม)\n\n` +
          `พิมพ์คำว่า  ยืนยัน  เพื่อยืนยันการส่งซ้ำ:`,
      );
      if (typed === null) return;
      if (typed.trim() !== "ยืนยัน") {
        setMsg({ kind: "err", text: 'ยกเลิก — ต้องพิมพ์คำว่า "ยืนยัน" ให้ถูกต้อง' });
        return;
      }
      setBusy(`force-${day.sales_date}`);
      setMsg(null);
      try {
        const res = await fetch("/api/cashhub/amazon-import/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeCode,
            storeLabel: branchLabel,
            force: true,
            confirm: "ยืนยัน",
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
        const data = (await res.json()) as { ok: boolean; ivNo?: string; error?: string };
        if (data.ok)
          setMsg({
            kind: "ok",
            text: `ส่งซ้ำสำเร็จ — สร้างใบทดสอบ IV ${data.ivNo} (วันที่ ${day.sales_date}) · อย่าลืมลบใบทดสอบใน TRCloud`,
          });
        else setMsg({ kind: "err", text: `${day.sales_date}: ${data.error ?? "ล้มเหลว"}` });
      } catch {
        setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
      } finally {
        setBusy(null);
      }
    },
    [storeCode],
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
            storeLabel: branchLabel,
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
        d.balanced ? "พร้อม" : `ติดปัญหา${d.block_reason ? ": " + d.block_reason : ""}`,
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
          {canSend && (
            <>
              <Link
                href="/cashhub/amazon/settings"
                className="h-11 inline-flex items-center rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50"
              >
                ⚙️ ตั้งค่าช่องทาง
              </Link>
              <button
                type="button"
                disabled={busy !== null || savedDays.length === 0}
                onClick={sendReconcile}
                className="h-11 rounded-xl bg-[var(--ch-navy,#0b1850)] px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy === "reconcile" ? "กำลังส่ง…" : "🏦 ส่งเข้า reconcile"}
              </button>
            </>
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

          {/* สรุป reconcile (เงินเข้าจริงที่ส่งเข้าบัญชี แมตช์ยอดไปเท่าไหร่) */}
          {reconcile.totalSent > 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-700">
                  🏦 กระทบยอดธนาคาร (reconcile)
                </div>
                <div className="text-sm text-zinc-600">
                  แมตช์แล้ว{" "}
                  <b className="text-emerald-600">{formatBaht(reconcile.totalMatched)}</b>{" "}
                  / ส่งเข้า {formatBaht(reconcile.totalSent)}{" "}
                  <b className="text-zinc-900">
                    ({Math.round((reconcile.totalMatched / reconcile.totalSent) * 100)}%)
                  </b>
                </div>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${Math.round((reconcile.totalMatched / reconcile.totalSent) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* excel grid (สเปรดชีตเต็ม — มิเรอร์สไตล์หน้าโรงแรม) */}
          <AmazonExcelGrid
            savedDays={savedDays}
            canSend={canSend}
            busy={busy}
            onCreate={createIv}
            onForce={forceSend}
            configs={configs}
            reconcile={reconcile}
          />
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
    <div className="rounded-xl bg-white border border-zinc-200 px-4 py-2 text-center">
      <div className={`text-lg font-bold ${c}`}>{n}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
