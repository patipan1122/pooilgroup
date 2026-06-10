"use client";

// การส่งออกเข้า TRCloud — Phase 1 = CSV รายเดือน (ใช้งานได้จริง).
// เลือกงวด → กด "ส่งออก CSV" → ระบบดึงรายการที่ "ยืนยันแล้ว" ในงวดนั้น →
// ดาวน์โหลดไฟล์ + บันทึก export batch + audit. *** ไม่แตะร่าง (draft) ***
// Phase 2 (TRCloud API) ยังรอ token/endpoint — ดู lib/ledger/trcloud-export.ts.
import { useState, useTransition } from "react";
import { FileSpreadsheet, Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportConfirmedCsv } from "../../_actions";

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function ExportConfigCard({ companyId }: { companyId: string }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const validPeriod = /^\d{4}-\d{2}$/.test(period);

  function run() {
    if (!validPeriod) {
      setMsg({ kind: "err", text: "งวดต้องอยู่ในรูปแบบ YYYY-MM" });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await exportConfirmedCsv({ companyId, period });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      // Trigger a client-side download of the returned CSV.
      try {
        const blob = new Blob(["﻿" + res.csv], {
          type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setMsg({ kind: "ok", text: `ส่งออก ${res.rows} รายการแล้ว · ${res.filename}` });
      } catch {
        setMsg({ kind: "err", text: "ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-blue-100 text-blue-700">
          <FileSpreadsheet className="size-4" aria-hidden />
        </span>
        <h2 className="text-sm font-bold text-zinc-800">ส่งออกเข้า TRCloud</h2>
      </div>
      <p className="mb-3 text-sm text-zinc-500">
        ส่งค่าใช้จ่ายที่ &quot;ยืนยันแล้ว&quot; เข้า TRCloud (book of record) —
        เริ่มจาก CSV รายเดือน
      </p>

      <details className="mb-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
        <summary className="cursor-pointer font-semibold text-zinc-700">
          ดูคอลัมน์ (สำหรับช่างเทคนิค)
        </summary>
        <div className="mt-2">
          คอลัมน์ CSV:{" "}
          <code className="font-mono">
            doc_code, doc_date, vendor, vendor_tax_id, acc_code, subtotal, vat, wht, total, note
          </code>
          <div className="mt-2 text-amber-700">
            <strong>หมายเหตุ:</strong> คอลัมน์เป็นค่าเริ่มต้น — ปรับให้ตรง template
            ของ TRCloud ได้ (ดู <code>docs/LEDGER_SETUP.md</code>). Phase 2 จะส่งผ่าน API
            อัตโนมัติ
          </div>
        </div>
      </details>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label
            htmlFor="export-period"
            className="mb-1 block text-xs font-semibold text-zinc-600"
          >
            งวด
          </label>
          <input
            id="export-period"
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value.trim());
              setMsg(null);
            }}
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
        </div>
        <Button
          variant="primary"
          onClick={run}
          disabled={pending || !companyId || !validPeriod}
          title={!validPeriod ? "ใส่งวดเป็น YYYY-MM ก่อน" : undefined}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
          ส่งออก CSV
        </Button>
      </div>

      {msg && (
        <div
          className={
            "mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm " +
            (msg.kind === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-800")
          }
          role="status"
          aria-live="polite"
        >
          {msg.kind === "ok" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}
