"use client";

// การส่งออกเข้า TRCloud — STUB (Phase 1 = CSV; Phase 2 = TRCloud API).
// TODO[ledger-secret]: ฟอร์แมต/คอลัมน์ CSV ของ TRCloud + API import endpoint
// ต้องรอ CEO ยืนยัน (ดู PLAN_ledger_module.md §7). การ map จริงอยู่ใน
// lib/ledger/trcloud-export.ts (Partition B).
import { FileSpreadsheet, Download } from "lucide-react";

export function ExportConfigCard() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-blue-100 text-blue-700">
          <FileSpreadsheet className="size-4" />
        </span>
        <h2 className="text-sm font-bold text-zinc-800">ส่งออกเข้า TRCloud</h2>
      </div>
      <p className="mb-3 text-sm text-zinc-500">
        ส่งค่าใช้จ่ายที่ &quot;ยืนยันแล้ว&quot; เข้า TRCloud (book of record) —
        เริ่มจาก CSV รายเดือน
      </p>

      <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
        รูปแบบ CSV: <code className="mx-1">วันที่, เลขที่, ผู้ขาย, เลขภาษี, หมวด, รหัสบัญชี, ยอดย่อย, VAT, หัก ณ ที่จ่าย, ยอดรวม</code>
        <div className="mt-2 text-amber-700">
          <strong>รอยืนยัน:</strong> คอลัมน์ที่ TRCloud ต้องการ + มี API import หรือไม่
          (ดู <code>docs/LEDGER_SETUP.md</code>)
        </div>
      </div>

      <button
        disabled
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-400"
        title="พร้อมใช้งานเมื่อยืนยันฟอร์แมต TRCloud"
      >
        <Download className="size-4" />
        ส่งออก CSV (เร็วๆ นี้)
      </button>
    </div>
  );
}
