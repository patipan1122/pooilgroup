"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";
import { TH_MONTHS } from "@/lib/cashhub/hotel";

type Preview = {
  diff: { new: number; changed: number; same: number; total: number };
  totals: { rooms: number; totalSales: number; qrTotal: number; qrBanked: number };
  warnings: string[];
  sheetName: string;
  sample: Array<{
    sales_date: string;
    shift: string;
    total_sales: number | null;
    qr_total: number | null;
    staff_name: string | null;
  }>;
};

export function HotelImportShell({
  branches,
}: {
  branches: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const now = new Date();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send(commit: boolean) {
    if (!file) return setErr("เลือกไฟล์ก่อน");
    if (!branchId) return setErr("เลือกสาขา");
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("branchId", branchId);
      fd.set("year", String(year));
      fd.set("month", String(month));
      fd.set("commit", commit ? "true" : "false");
      const res = await fetch("/api/cashhub/hotel-import", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "เกิดข้อผิดพลาด");
        if (json.warnings?.length) setErr(`${json.error} · ${json.warnings.join(", ")}`);
        return;
      }
      if (commit) {
        setDone(
          `บันทึกแล้ว: ใหม่ ${json.diff.new} · แก้ไข ${json.diff.changed} · เท่าเดิม ${json.diff.same}`,
        );
        setPreview(null);
      } else {
        setPreview(json as Preview);
      }
    } catch {
      setErr("เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-3xl mb-2">✅</div>
        <div className="font-bold text-emerald-800">นำเข้าสำเร็จ</div>
        <div className="text-sm text-emerald-700 mt-1">{done}</div>
        <button
          onClick={() =>
            router.push(
              `/cashhub/hotel?branchId=${branchId}&month=${year}-${String(month).padStart(2, "0")}`,
            )
          }
          className="mt-4 h-10 px-5 rounded-xl bg-[var(--color-brand-600,#1e3aff)] text-white font-semibold text-sm"
        >
          ดูหน้าตรวจยอดขาย →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-2">
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
        >
          {branches.length === 0 && <option value="">— ไม่มีสาขาโรงแรม —</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
        >
          {TH_MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
        />
      </div>

      <label className="block rounded-2xl border-2 border-dashed border-zinc-300 p-6 text-center cursor-pointer hover:border-[var(--color-brand-600,#1e3aff)]">
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
        />
        <div className="text-2xl mb-1">📄</div>
        <div className="text-sm font-semibold text-zinc-700">
          {file ? file.name : "เลือกไฟล์ Excel (.xlsx)"}
        </div>
        <div className="text-xs text-zinc-400 mt-0.5">
          กดเพื่อเลือกไฟล์ที่ดาวน์โหลดจาก Google Sheet
        </div>
      </label>

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {err}
        </div>
      )}

      {preview && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="text-sm font-bold text-zinc-800">
            ตัวอย่างก่อนบันทึก · ชีต “{preview.sheetName}”
          </div>
          {preview.warnings.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
              ⚠️ {preview.warnings.join(" · ")}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="ยอดขายรวม" value={formatBaht(preview.totals.totalSales)} />
            <Stat label="ห้องรวม" value={preview.totals.rooms.toLocaleString()} />
            <Stat label="QR บันทึก" value={formatBaht(preview.totals.qrTotal)} />
            <Stat label="QR เข้าบัญชี" value={formatBaht(preview.totals.qrBanked)} />
          </div>
          <div className="flex gap-2 text-xs">
            <Pill tone="brand">ใหม่ {preview.diff.new}</Pill>
            <Pill tone="amber">แก้ไข {preview.diff.changed}</Pill>
            <Pill tone="zinc">เท่าเดิม {preview.diff.same}</Pill>
          </div>
          <p className="text-xs text-zinc-500">
            👉 เทียบ “ยอดขายรวม” กับยอดท้ายชีตให้ตรงก่อนกดยืนยัน
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          disabled={busy || !file}
          onClick={() => send(false)}
          className="h-11 flex-1 rounded-xl border border-zinc-300 font-semibold text-sm disabled:opacity-50"
        >
          {busy ? "กำลังอ่าน…" : "ดูตัวอย่าง"}
        </button>
        <button
          disabled={busy || !preview}
          onClick={() => send(true)}
          className="h-11 flex-1 rounded-xl bg-[var(--color-brand-600,#1e3aff)] text-white font-semibold text-sm disabled:opacity-40"
        >
          ยืนยันนำเข้า
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 p-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="font-bold tabular-nums text-zinc-900 text-sm">{value}</div>
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "brand" | "amber" | "zinc";
}) {
  const c =
    tone === "brand"
      ? "bg-blue-50 text-blue-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : "bg-zinc-100 text-zinc-600";
  return (
    <span className={`px-2 py-1 rounded-lg font-semibold ${c}`}>{children}</span>
  );
}
