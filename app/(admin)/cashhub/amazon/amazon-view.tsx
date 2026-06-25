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
  allowForce: boolean;
  history: ImportHistoryRow[];
  configs: ChannelConfig[];
  reconcile: ReconcileStatus;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// วันที่ยอดรวมตรง แต่ "ไส้ใน" (รายช่องทาง หรือ VAT) ในใบกำกับ ≠ POS — จุดที่เทียบยอดรวมจับไม่ได้
// (ต้องตรวจไส้ในแล้ว = มี iv_channels) · ทน ±1 บาท (special_note เก็บจำนวนเต็ม)
function hasInnerMismatch(d: SavedAmazonDay): boolean {
  if (!d.iv_channels) return false;
  const keys = new Set([
    ...Object.keys(d.channels ?? {}),
    ...Object.keys(d.iv_channels),
  ]);
  for (const k of keys)
    if (Math.abs((d.iv_channels[k] ?? 0) - (d.channels?.[k] ?? 0)) >= 1) return true;
  if (d.iv_gross != null && d.iv_pre_vat != null)
    if (Math.abs(d.iv_gross - d.iv_pre_vat - (d.vat ?? 0)) >= 1) return true;
  return false;
}

export function AmazonView({
  storeCode,
  branchLabel,
  branchType,
  from,
  to,
  savedDays,
  canSend,
  allowForce,
  history,
  configs,
  reconcile,
}: Props) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{
    kind: "ok" | "err";
    text: string;
    unknownBranch?: boolean;
  } | null>(null);

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
        unknownBranch?: boolean;
      };
      if (!res.ok || data.error) {
        setMsg({
          kind: "err",
          text: data.error ?? "อ่านไฟล์ไม่สำเร็จ",
          unknownBranch: data.unknownBranch,
        });
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
        sentUnbalanced?: string[];
        error?: string;
      };
      if (!res.ok || data.error) setMsg({ kind: "err", text: data.error ?? "ส่งไม่สำเร็จ" });
      else {
        // วันที่ยอด POS ไม่ลงตัวแต่ส่งเงินช่องทางจริงเข้าไปแล้ว → แจ้งให้เห็น ไม่ปล่อยเงียบ
        const unbal = data.sentUnbalanced ?? [];
        const unbalNote = unbal.length
          ? ` · ⚠️ ${unbal.length} วันยอด POS ไม่ลงตัว (ส่งเงินให้แล้ว ควรตรวจไฟล์ปิดกะ): ${unbal.map((d) => d.slice(5)).join(", ")}`
          : "";
        setMsg({
          kind: "ok",
          text: `ส่งเข้า reconcile แล้ว ${data.inserted} รายการ${data.skippedNoConfig ? ` · ข้าม ${data.skippedNoConfig} (ยังไม่ตั้งบัญชี)` : ""}${unbalNote} → ดูที่หน้ากระทบยอดธนาคาร`,
        });
        router.refresh(); // โหลดสถานะ "กระทบยอด" + แถบสรุปใหม่ (ไม่งั้นคอลัมน์ค้าง "—" เหมือนยังไม่ส่ง)
      }
    } catch {
      setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }, [storeCode, branchLabel, from, to, router]);

  // ⚠️ ฝืนส่ง (super_admin) — ข้ามด่านตรวจ/dedup → ส่งได้ทุกกรณี รวมใบซ้ำ · ต้องพิมพ์ยืนยัน
  const forceSend = useCallback(
    async (day: SavedAmazonDay) => {
      const hasIv = day.match_state === "match" || day.iv_status === "posted";
      const typed = window.prompt(
        hasIv
          ? `⚠️ ฝืนส่งซ้ำเข้า TRCloud — วันที่ ${day.sales_date} (ยอด ${formatBaht(day.gross)})\n\n` +
            `วันนี้มีใบกำกับ ${day.iv_doc_no ?? ""} อยู่แล้ว!\n` +
            `ส่งอีก = ได้ใบกำกับ "ซ้ำ" + VAT ถูกนับซ้ำใน ภ.พ.30\n\n` +
            `พิมพ์คำว่า  ยืนยัน  เพื่อฝืนส่งซ้ำ:`
          : `⚠️ ฝืนส่งเข้า TRCloud — วันที่ ${day.sales_date} (ยอด ${formatBaht(day.gross)})\n\n` +
            `ระบบเตือนว่าข้อมูลยังไม่ครบ — กำลังฝืนส่ง (super admin)\n\n` +
            `พิมพ์คำว่า  ยืนยัน  เพื่อฝืนส่ง:`,
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
            text: hasIv
              ? `ฝืนส่งซ้ำสำเร็จ — สร้าง IV ${data.ivNo} (วันที่ ${day.sales_date}) · ⚠️ เป็นใบซ้ำ ตรวจ TRCloud + ภ.พ.30 ด้วย`
              : `ฝืนส่งสำเร็จ — สร้าง IV ${data.ivNo} (วันที่ ${day.sales_date}) · ตรวจ TRCloud ให้ตรงด้วย`,
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
    let ok = 0;
    const failed: string[] = [];
    let rateLimited = false;
    for (let i = 0; i < ready.length; i++) {
      const day = ready[i]!;
      setMsg({ kind: "ok", text: `กำลังสร้าง ${day.sales_date}… (${i + 1}/${ready.length})` });
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
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && data.ok) ok++;
        else {
          failed.push(day.sales_date.slice(5));
          // TRCloud ติด rate-limit → หยุด (ยิงต่อก็พลาดหมด) ไม่รายงานเท็จว่าครบ
          if (/rate-limit|429/.test(data.error ?? "")) {
            rateLimited = true;
            break;
          }
        }
      } catch {
        failed.push(day.sales_date.slice(5));
      }
      await sleep(1300); // throttle 429
    }
    setBusy(null);
    router.refresh();
    if (failed.length === 0) {
      setMsg({ kind: "ok", text: `สร้าง IV สำเร็จครบ ${ok} วัน` });
    } else {
      setMsg({
        kind: "err",
        text:
          `สร้างสำเร็จ ${ok} วัน · ล้มเหลว ${failed.length} วัน: ${failed.join(", ")}` +
          (rateLimited ? " — TRCloud ติด rate-limit หยุดไว้ก่อน ลองใหม่อีก 1-2 นาที" : " — ลองใหม่เฉพาะวันที่พลาด"),
      });
    }
  }, [savedDays, storeCode, branchLabel, router]);

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
    // "ติดปัญหา" = ยังคีย์ IV ไม่ได้ + ยังไม่มี IV จริง · วันที่มี IV ตรงแล้ว = เรียบร้อย ไม่นับ
    blocked: savedDays.filter(
      (d) => !d.balanced && d.match_state !== "match" && d.iv_status !== "posted",
    ).length,
    // "ยังไม่เทียบ" = match_state ยังเป็น null (เพิ่งอัปไฟล์ใหม่ หรือ TRCloud จำกัดการเรียกชั่วคราว)
    // → จุดบอดเดิม: วันพวกนี้โชว์ "—" เหมือนทุกอย่างเรียบร้อย ทั้งที่ยังไม่เคยถูกเทียบ
    notChecked: savedDays.filter((d) => d.match_state == null).length,
    // "ไส้ในเพี้ยน" = ยอดรวมตรง แต่รายช่องทาง/VAT ในใบ ≠ POS (ดูช่องสีเหลืองในตาราง)
    innerMismatch: savedDays.filter(hasInnerMismatch).length,
  };

  return (
    <div className="space-y-5">
      {/* upload + actions */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium hover:bg-zinc-100 w-full sm:w-auto">
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
            className="h-11 w-full sm:w-auto rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy === "upload" ? "กำลังอ่าน + เซฟ…" : "อัปไฟล์ + เซฟ"}
          </button>
          <div className="hidden sm:block grow" />
          {/* การทำงานหลัก (เด่น) */}
          <button
            type="button"
            disabled={busy !== null || savedDays.length === 0}
            onClick={refreshMatch}
            className="h-11 w-full sm:w-auto rounded-xl border border-zinc-200 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            {busy === "match" ? "กำลังเทียบ…" : "🔄 เทียบกับ TRCloud"}
          </button>
          {canSend && (
            <button
              type="button"
              disabled={busy !== null || savedDays.length === 0}
              onClick={sendReconcile}
              className="h-11 w-full sm:w-auto rounded-xl bg-[var(--ch-navy,#0b1850)] px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === "reconcile" ? "กำลังส่ง…" : "🏦 ส่งเข้า reconcile"}
            </button>
          )}
          {/* เครื่องมือรอง (ย่อ ghost) */}
          <div className="flex items-center gap-1 sm:ml-1 sm:border-l border-zinc-200 sm:pl-2">
            <button
              type="button"
              disabled={savedDays.length === 0}
              onClick={exportXlsx}
              title="ดาวน์โหลด Excel"
              className="h-9 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
            >
              ⬇ Excel
            </button>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                title="ประวัติการอัปไฟล์"
                className="h-9 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
              >
                🕘 ประวัติ ({history.length})
              </button>
            )}
            {canSend && (
              <Link
                href="/cashhub/amazon/settings"
                title="ตั้งค่าช่องทาง/ค่าธรรมเนียม/บัญชี"
                className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
              >
                ⚙️ ตั้งค่า
              </Link>
            )}
          </div>
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
                  {h.file && <span className="text-zinc-500">· {h.file}</span>}
                  <span className="text-zinc-500">· โดย {h.by}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          {branchType ? `สูตรบัญชี: ${branchType} · ` : ""}อัปแล้วเซฟถาวร · กด&ldquo;เทียบกับ
          TRCloud&rdquo; เพื่อดึงใบกำกับมาเทียบ — ทั้ง<b>ยอดรวม</b>และ<b>ไส้ในรายช่องทาง + VAT</b>
          (ช่องที่ในใบไม่ตรง POS จะขึ้นสีเหลือง)
        </p>
        {msg && (
          <div
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {msg.text}
            {msg.unknownBranch && canSend && (
              <a
                href="/cashhub/amazon/branches"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white font-semibold px-3 py-1.5 text-xs hover:bg-emerald-700"
              >
                🏪 ไปหน้าจัดการสาขา → เพิ่มสาขานี้
              </a>
            )}
          </div>
        )}
      </div>

      {savedDays.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          ยังไม่มีข้อมูลเดือนนี้ — อัปไฟล์ปิดกะ POS ด้านบนเพื่อเริ่ม
        </div>
      ) : (
        <>
          {/* แจ้งเตือนยอดไม่ตรง / ติดปัญหา / ไส้ในเพี้ยน */}
          {(stat.mismatch > 0 || stat.blocked > 0 || stat.innerMismatch > 0) && (
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
                {stat.innerMismatch > 0 && (
                  <li>
                    • <b>{stat.innerMismatch} วัน</b> ยอดรวมตรง แต่ <b>ไส้ใน</b>
                    (รายช่องทาง/VAT) ในใบไม่ตรง POS — ดู<b>ช่องสีเหลือง</b>ในตาราง:{" "}
                    {savedDays
                      .filter(hasInnerMismatch)
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

          {/* นัดจ์: วันที่ "ยังไม่ถูกเทียบ" กับ TRCloud (จุดบอดเดิม — TRCloud จำกัดการเรียก/เพิ่งอัปไฟล์ →
              วันพวกนี้โชว์ "—" เหมือนเรียบร้อย ทั้งที่ยังไม่รู้ว่าตรงหรือไม่ตรง) → เตือน + ปุ่มเทียบซ้ำ */}
          {stat.notChecked > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="font-bold text-amber-800">
                🔄 มี {stat.notChecked} วันที่ <b>ยังไม่ได้เทียบ</b>กับ TRCloud
              </div>
              <div className="mt-1 text-sm text-amber-700">
                วันเหล่านี้ยังไม่รู้ว่าตรงหรือไม่ตรง (เพิ่งอัปไฟล์ใหม่ หรือ TRCloud จำกัดการเรียกชั่วคราว) —{" "}
                {savedDays
                  .filter((d) => d.match_state == null)
                  .map((d) => d.sales_date.slice(5))
                  .join(", ")}
              </div>
              <button
                type="button"
                disabled={busy !== null || savedDays.length === 0}
                onClick={refreshMatch}
                className="mt-2 inline-flex h-9 items-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {busy === "match" ? "กำลังเทียบ…" : "🔄 เทียบกับ TRCloud อีกครั้ง"}
              </button>
            </div>
          )}

          {/* summary */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <Stat n={stat.days} label="วันทั้งหมด" />
              <Stat n={stat.match} label="ตรงกับ TRC" tone="ok" />
              <Stat n={stat.mismatch} label="ไม่ตรง" tone="warn" />
              {stat.innerMismatch > 0 && (
                <Stat n={stat.innerMismatch} label="ไส้ในเพี้ยน" tone="warn" />
              )}
              <Stat n={stat.notChecked} label="ยังไม่เทียบ" tone="warn" />
              <Stat n={stat.noIv} label="ยังไม่มี IV" tone="info" />
              <Stat n={stat.blocked} label="ติดปัญหา" tone="warn" />
            </div>
            {stat.noIv > 0 && canSend && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={createAllReady}
                className="w-full sm:w-auto sm:ml-auto h-11 self-center rounded-xl bg-[var(--ch-brand,#1e3aff)] px-5 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy === "push-all" ? "กำลังสร้าง…" : `✓ สร้าง IV ที่ยังไม่มี (${stat.noIv} วัน)`}
              </button>
            )}
            {stat.noIv > 0 && !canSend && (
              <span className="w-full sm:w-auto sm:ml-auto self-center text-xs text-zinc-500">
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
            allowForce={allowForce}
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
