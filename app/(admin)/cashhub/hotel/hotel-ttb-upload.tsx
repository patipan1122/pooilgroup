"use client";

// อัปโหลดไฟล์ธนาคาร TTB Smart Shop (รหัส 3468) → QR เงินเข้าจริง → เติมในตาราง
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";

type Result = {
  successCount: number;
  skipped: number;
  totalBanked: number;
  daysInFile: number;
  updated: number;
  unmatched: number;
  diffAbs: number;
};

export function HotelTtbUpload({
  branchId,
  month,
  source = "trcloud_iv",
}: {
  branchId: string | null;
  month: string;
  source?: string;
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

      {res && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 space-y-1">
          <div className="font-bold">
            ✅ QR เงินเข้าจริงรวม {formatBaht(res.totalBanked)} ({res.successCount}{" "}
            รายการสำเร็จ)
          </div>
          <div className="text-xs">
            เติมเข้าตาราง {res.updated} วัน · ส่วนต่างรวม {formatBaht(res.diffAbs)}
            {res.unmatched > 0 && ` · ${res.unmatched} วันไม่มีแถวให้เติม`}
            {res.skipped > 0 && ` · ข้ามรายการไม่สำเร็จ ${res.skipped}`}
          </div>
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
    </div>
  );
}
