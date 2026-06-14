"use client";

// อัปโหลดไฟล์ธนาคาร TTB Smart Shop (รหัส 3468) → QR เงินเข้าจริง → เติมในตาราง
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";

type Result = {
  successCount: number;
  fileTotal: number;
  skipped: number;
  totalBanked: number;
  totalRecorded: number;
  monthDiff: number;
  daysInFile: number;
  firstDate: string | null;
  lastDate: string | null;
  updated: number;
  unmatched: number;
  duplicate: { at: string; fileName: string } | null;
};

export type TtbHistoryItem = {
  at: string;
  fileName: string;
  firstDate: string | null;
  lastDate: string | null;
  daysInFile: number;
  updated: number;
  totalBanked: number;
};

const dayOf = (iso: string | null) => (iso ? Number(iso.slice(8, 10)) : null);

export function HotelTtbUpload({
  branchId,
  month,
  source = "trcloud_iv",
  history = [],
}: {
  branchId: string | null;
  month: string;
  source?: string;
  history?: TtbHistoryItem[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function upload() {
    if (!file) return setErr("เลือกไฟล์ก่อน");
    if (!branchId) return setErr("ไม่มีสาขา");
    setBusy(true);
    setErr(null);
    try {
      const [y, m] = month.split("-").map(Number);
      const fd = new FormData();
      fd.set("file", file);
      fd.set("branchId", branchId);
      fd.set("year", String(y));
      fd.set("month", String(m));
      fd.set("source", source);
      const r = await fetch("/api/cashhub/hotel/ttb-upload", {
        method: "POST",
        body: fd,
      });
      const json = await r.json();
      if (!r.ok) return setErr(json.error ?? "อัปโหลดไม่สำเร็จ");
      setRes(json as Result);
    } catch {
      setErr("เชื่อมต่อไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div>
        <div className="font-bold text-zinc-800">
          🏦 QR เงินเข้าจริง — อัปโหลดไฟล์ธนาคาร TTB (รหัส 3468)
        </div>
        <div className="text-xs text-zinc-500">
          ธนาคารตัดยอด QR ตามวันจริง (เที่ยงคืน–เที่ยงคืน) → เติม “เข้าบัญชี” + “ส่วนต่าง QR”
          ให้ถูกต้อง แก้ปัญหายอด QR หลังเที่ยงคืน
        </div>
      </div>

      {/* วิธีการสำหรับพนักงาน */}
      <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3 text-xs text-blue-900">
        <div className="font-semibold mb-1">วิธีดึงไฟล์ (สำหรับพนักงาน):</div>
        <ol className="list-decimal ml-4 space-y-0.5">
          <li>เข้าระบบ <b>TTB Smart Shop</b></li>
          <li>เมนู “รายงานการขาย” → เลือกเดือนที่ต้องการ (บัญชีรหัส <b>3468</b>)</li>
          <li>ดาวน์โหลดเป็นไฟล์ <b>Excel</b> หรือ CSV</li>
          <li>อัปโหลดไฟล์ที่นี่ → ระบบจะคิด “QR เงินเข้าจริง” ให้เอง</li>
        </ol>
      </div>

      <label className="block rounded-xl border-2 border-dashed border-zinc-300 p-4 text-center cursor-pointer hover:border-[var(--ch-navy,#0b1850)]">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setRes(null);
            setErr(null);
          }}
        />
        <div className="text-sm font-semibold text-zinc-700">
          {file ? file.name : "เลือกไฟล์ TTB (.xlsx / .csv)"}
        </div>
      </label>

      {err && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-2.5">
          {err}
        </div>
      )}

      {res?.duplicate && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-2.5">
          🔁 ไฟล์นี้เคยอัปแล้ว (เนื้อหาเหมือนกัน) เมื่อ{" "}
          <b>
            {new Date(res.duplicate.at).toLocaleString("th-TH", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </b>{" "}
          — ระบบเขียนทับยอดเดิม (ไม่บวกซ้ำ) ปลอดภัย
        </div>
      )}

      {res && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 space-y-1">
          <div className="font-bold">
            ✅ QR เงินเข้าจริงรวม {formatBaht(res.totalBanked)} ({res.successCount}{" "}
            รายการสำเร็จ · ตัดยอด 23:00)
          </div>
          <div className="text-xs">
            เติม “เข้าบัญชี” {res.updated} วัน · QR บันทึก (ตามกะ){" "}
            {formatBaht(res.totalRecorded)} · ต่างทั้งเดือน {formatBaht(res.monthDiff)}
            {res.unmatched > 0 && ` · ${res.unmatched} วันไม่มีแถวให้เติม`}
            {res.skipped > 0 && ` · ข้ามไม่สำเร็จ ${res.skipped}`}
          </div>
          {res.firstDate && (
            <div className="text-xs">
              📅 ไฟล์นี้มี QR วันที่ <b>{dayOf(res.firstDate)}–{dayOf(res.lastDate)}</b>
              {(dayOf(res.firstDate) ?? 1) > 1 && (
                <span className="text-amber-700 font-semibold">
                  {" "}
                  ⚠️ ไม่ครบเดือน! ขาดวันที่ 1–{(dayOf(res.firstDate) ?? 1) - 1} —
                  ดาวน์โหลด TTB ทั้งเดือนแล้วอัปใหม่ (หรืออัปไฟล์ต้นเดือนเพิ่ม)
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-1 h-8 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
          >
            รีเฟรชดูตาราง →
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={upload}
        disabled={busy || !file}
        className="h-10 w-full rounded-xl bg-[var(--ch-navy,#0b1850)] text-white font-semibold text-sm disabled:opacity-50"
      >
        {busy ? "กำลังอ่านไฟล์…" : "อัปโหลด + คิด QR เงินเข้าจริง"}
      </button>

      {history.length > 0 && (
        <div className="pt-2 border-t border-zinc-100">
          <div className="text-xs font-semibold text-zinc-600 mb-1.5">
            ประวัติการอัปโหลด ({history.length})
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 text-xs bg-zinc-50 rounded-lg px-2.5 py-1.5"
              >
                <span className="text-zinc-700 truncate max-w-[55%]" title={h.fileName}>
                  📄 {h.fileName}
                </span>
                <span className="text-zinc-500 tabular-nums">
                  วันที่ {dayOf(h.firstDate) ?? "?"}–{dayOf(h.lastDate) ?? "?"} ·{" "}
                  {h.updated} วัน · {formatBaht(h.totalBanked)} ·{" "}
                  {new Date(h.at).toLocaleString("th-TH", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
