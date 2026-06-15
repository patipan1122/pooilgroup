"use client";

import { useState, useTransition } from "react";
import { Copy, Trash2, RefreshCw, CheckCircle2 } from "lucide-react";
import { findBankDuplicatesAction, purgeBankDuplicatesAction } from "../../_movement-actions";

function baht(s: number) {
  return (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Sample {
  date: string;
  amountSatang: number;
  ref: string;
  copies: number;
}

export function DuplicateCleanup({ bankAccountId }: { bankAccountId: string }) {
  const [state, setState] = useState<"idle" | "checked" | "done">("idle");
  const [extra, setExtra] = useState(0);
  const [sample, setSample] = useState<Sample[]>([]);
  const [deleted, setDeleted] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function check() {
    setErr(null);
    start(async () => {
      const res = await findBankDuplicatesAction(bankAccountId);
      if (!res.ok) { setErr(res.error ?? "ตรวจไม่สำเร็จ"); return; }
      setExtra(res.extraCount);
      setSample(res.sample);
      setState("checked");
      setConfirming(false);
    });
  }

  function purge() {
    setErr(null);
    start(async () => {
      const res = await purgeBankDuplicatesAction(bankAccountId);
      if (!res.ok) { setErr(res.error ?? "ลบไม่สำเร็จ"); return; }
      setDeleted(res.deleted);
      setState("done");
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Copy className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium text-zinc-900">รายการซ้ำ (นำเข้าซ้ำ)</h3>
        {state === "idle" && (
          <button
            onClick={check}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} /> ตรวจรายการซ้ำ
          </button>
        )}
      </div>

      {state === "checked" && (
        extra === 0 ? (
          <p className="mt-2 text-sm text-emerald-600">✓ ไม่พบรายการซ้ำ — สะอาดดี</p>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-zinc-700">
              พบรายการซ้ำที่ลบได้ <b className="text-rose-600">{extra.toLocaleString()}</b> รายการ
              <span className="text-zinc-400"> (เก็บไว้กลุ่มละ 1 ใบ · ลบเฉพาะที่ยังไม่กระทบยอด)</span>
            </p>
            <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-zinc-100 text-xs">
              {sample.map((s, i) => (
                <div key={i} className="flex items-center gap-2 border-b border-zinc-50 px-2.5 py-1.5 last:border-0">
                  <span className="text-zinc-400">{s.date}</span>
                  <span className="font-medium text-zinc-700">฿{baht(s.amountSatang)}</span>
                  <span className="truncate text-zinc-500">{s.ref}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-rose-50 px-1.5 text-rose-600">×{s.copies}</span>
                </div>
              ))}
            </div>
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="mt-3 inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                <Trash2 className="h-4 w-4" /> ลบรายการซ้ำ {extra.toLocaleString()} รายการ
              </button>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-rose-700">แน่ใจนะ? ลบถาวร</span>
                <button onClick={purge} disabled={pending}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                  ยืนยันลบ
                </button>
                <button onClick={() => setConfirming(false)} disabled={pending}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600">
                  ยกเลิก
                </button>
              </div>
            )}
          </div>
        )
      )}

      {state === "done" && (
        <p className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-600">
          <CheckCircle2 className="h-4 w-4" /> ลบรายการซ้ำแล้ว {deleted.toLocaleString()} รายการ — หน้ากระทบยอดจะโล่งขึ้น
        </p>
      )}

      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
