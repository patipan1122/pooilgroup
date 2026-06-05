"use client";

// One-button Rich Menu setup for the LedgerLine LINE OA. POSTs to
// /api/ledger/richmenu/register (admin-gated, uses the connected channel's
// encrypted token). Shows the 6 cells so the operator knows what they're setting.

import { useState } from "react";
import { Loader2, LayoutGrid, CheckCircle2, AlertTriangle } from "lucide-react";

const CELLS = [
  "ถ่ายใบเสร็จ",
  "พิมพ์รายจ่าย",
  "รายการของฉัน",
  "จัดการทีม",
  "วิธีใช้",
  "แจ้งปัญหา",
];

export function RichMenuButton({
  companyId,
  connected,
  alreadySet,
}: {
  companyId: string;
  connected: boolean;
  alreadySet: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function register() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/ledger/richmenu/register?company=${encodeURIComponent(companyId)}`,
        { method: "POST" },
      );
      const j = (await res.json()) as { ok: boolean; message?: string; error?: string };
      setMsg({ ok: j.ok, text: j.ok ? (j.message ?? "ตั้งเมนูสำเร็จ") : (j.error ?? "ตั้งเมนูไม่สำเร็จ") });
    } catch {
      setMsg({ ok: false, text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <LayoutGrid className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">เมนูในแชต LINE (Rich Menu)</h3>
        {alreadySet && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            ตั้งแล้ว
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        ปุ่มลัด 6 ปุ่มที่พนักงานเห็นใต้ช่องแชต — กดครั้งเดียวติดตั้งให้ทุกคน
      </p>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {CELLS.map((c) => (
          <div key={c} className="rounded-lg bg-zinc-50 px-2 py-2 text-center text-[11px] text-zinc-600">
            {c}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={register}
        disabled={busy || !connected}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#2563EB)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LayoutGrid className="size-4" aria-hidden />}
        {alreadySet ? "ตั้งเมนูใหม่อีกครั้ง" : "ติดตั้งเมนูในแชต"}
      </button>
      {!connected && (
        <p className="mt-2 text-[11px] text-amber-600">เชื่อมต่อ LINE OA ก่อน (การ์ดด้านบน) จึงจะตั้งเมนูได้</p>
      )}
      {msg && (
        <div
          className={`mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
            msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
          }`}
        >
          {msg.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}
