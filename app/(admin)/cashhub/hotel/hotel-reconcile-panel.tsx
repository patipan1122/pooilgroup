"use client";

// แถบ "กระทบยอดธนาคาร" — ส่งยอดเข้าจริง (QR/เงินสด) → ระบบบัญชี + แสดงสถานะ reconcile
// 🟢 กระทบ statement แล้ว · 🟡 ส่งแล้วรอกระทบ · ⚪ ยังไม่ส่ง
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";
import type {
  ReconcileChannelSummary,
  ReconcileDayView,
} from "@/lib/cashhub/hotel-settlement-data";

const DOT = { reconciled: "🟢", pending: "🟡", unsent: "⚪" } as const;
const STATE_TEXT = {
  reconciled: "text-emerald-700",
  pending: "text-amber-700",
  unsent: "text-zinc-400",
} as const;

export function HotelReconcilePanel({
  branchId,
  month,
  configured,
  canSend,
  summary,
  days,
}: {
  branchId: string;
  month: string; // "2026-04"
  configured: boolean;
  canSend: boolean;
  summary: ReconcileChannelSummary[];
  days: ReconcileDayView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDays, setShowDays] = useState(false);

  async function send() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const [y, m] = month.split("-").map(Number);
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const r = await fetch("/api/cashhub/hotel/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, from, to }),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "ส่งไม่สำเร็จ");
      setMsg(
        `✅ ส่งเข้าระบบบัญชีแล้ว ${j.inserted} รายการใหม่${j.skippedNoConfig ? ` · ข้าม ${j.skippedNoConfig} (ยังไม่ตั้งบัญชี)` : ""} → ไปกระทบยอดที่หน้าบัญชีธนาคาร`,
      );
      router.refresh();
    } catch {
      setErr("เชื่อมต่อไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  const totalRec = summary.reduce((a, s) => a + s.reconciledAmount, 0);
  const totalOut = summary.reduce((a, s) => a + s.outstandingAmount, 0);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-bold text-zinc-800">🏦 กระทบยอดธนาคาร (reconcile)</div>
          <div className="text-xs text-zinc-500">
            ส่งยอดเข้าจริงเข้าระบบบัญชี → นักบัญชีกระทบกับ statement → 🟢 เขียวเมื่อกระทบแล้ว
          </div>
        </div>
        {canSend && (
          <button
            type="button"
            onClick={send}
            disabled={busy || !configured}
            className="h-9 px-4 rounded-xl bg-[var(--ch-navy,#0b1850)] text-white text-sm font-semibold disabled:opacity-50 shrink-0"
          >
            {busy ? "กำลังส่ง…" : "ส่งเข้าระบบบัญชี"}
          </button>
        )}
      </div>

      {!configured && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-2.5">
          ⚠️ ยังไม่ได้ตั้งค่าช่องทาง→บัญชี — ติดต่อ super_admin
        </div>
      )}
      {msg && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-2.5">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-2.5">
          {err}
        </div>
      )}

      {/* สรุปต่อช่องทาง */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {summary.map((s) => {
          const allGood = s.daysWithDeposit > 0 && s.reconciledDays === s.daysWithDeposit;
          const none = s.reconciledDays === 0;
          return (
            <div
              key={s.channel}
              className={`rounded-xl border p-3 ${allGood ? "border-emerald-200 bg-emerald-50/50" : none ? "border-zinc-200 bg-zinc-50" : "border-amber-200 bg-amber-50/40"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-800">{s.label}</span>
                <span className="text-xs font-bold tabular-nums">
                  {s.reconciledDays}/{s.daysWithDeposit} วัน {allGood ? "🟢" : ""}
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3">
                <span>🟢 กระทบ {s.reconciledDays}</span>
                <span>🟡 รอ {s.pendingDays}</span>
                <span>⚪ ยังไม่ส่ง {s.unsentDays}</span>
              </div>
              <div className="text-xs mt-1.5 tabular-nums">
                <span className="text-emerald-700 font-semibold">กระทบแล้ว {formatBaht(s.reconciledAmount)}</span>
                {" · "}
                <span className="text-zinc-600">ค้าง {formatBaht(s.outstandingAmount)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-sm border-t border-zinc-100 pt-2.5">
        <span className="text-zinc-600">
          รวม: <b className="text-emerald-700">กระทบแล้ว {formatBaht(totalRec)}</b> ·{" "}
          <b className="text-zinc-700">ค้าง {formatBaht(totalOut)}</b>
        </span>
        {days.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDays((v) => !v)}
            className="h-7 px-2.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
          >
            {showDays ? "ซ่อนรายวัน" : "ดูรายวัน"}
          </button>
        )}
      </div>

      {showDays && (
        <div className="overflow-hidden rounded-xl border border-zinc-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-zinc-500 text-xs">
                <th className="px-2.5 py-1.5 text-left font-semibold">วันที่</th>
                {summary.map((s) => (
                  <th key={s.channel} className="px-2.5 py-1.5 text-right font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-zinc-50">
                  <td className="px-2.5 py-1.5 font-semibold text-zinc-700">{d.day}</td>
                  {summary.map((s) => {
                    const cell = d.cells.find((c) => c.channel === s.channel);
                    if (!cell)
                      return <td key={s.channel} className="px-2.5 py-1.5 text-right text-zinc-300">—</td>;
                    return (
                      <td
                        key={s.channel}
                        className={`px-2.5 py-1.5 text-right tabular-nums ${STATE_TEXT[cell.state]}`}
                      >
                        {DOT[cell.state]} {formatBaht(cell.amount)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-zinc-400">
        🟢 = นักบัญชีกระทบกับ statement ธนาคารจริงแล้ว · 🟡 = ส่งเข้าระบบแล้ว รอ statement มากระทบ ·
        ⚪ = ยังไม่ส่งเข้าระบบ · QR→TTB 3468 · เงินสด→BBL 933335
      </p>
    </div>
  );
}
