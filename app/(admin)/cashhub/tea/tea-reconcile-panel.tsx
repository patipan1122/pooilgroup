"use client";

// แถบ "กระทบยอดธนาคาร" ร้านชาไข่มุก — ส่งยอดเข้าจริง (net ต่อช่องทาง) → ระบบบัญชี + แสดงสถานะ reconcile
// 🟢 กระทบ statement แล้ว · 🟡 ส่งแล้วรอกระทบ · ⚪ ยังไม่ส่ง · mirror HotelReconcilePanel
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";
import type { SavedTeaDay } from "@/lib/cashhub/tea-data";
import {
  computeTeaSettlement,
  type TeaChannelConfig,
} from "@/lib/cashhub/tea-channels";
import type { TeaReconcileCell } from "@/lib/cashhub/tea-settlement-data";

const DOT = { reconciled: "🟢", pending: "🟡", unsent: "⚪" } as const;
const STATE_TEXT = {
  reconciled: "text-emerald-700",
  pending: "text-amber-700",
  unsent: "text-zinc-400",
} as const;

type CellState = "reconciled" | "pending" | "unsent";
type DayCell = { channel: string; amount: number; state: CellState };
type DayRow = { day: number; date: string; cells: DayCell[] };
type ChannelSummary = {
  channel: string;
  label: string;
  daysWithDeposit: number;
  reconciledDays: number;
  pendingDays: number;
  unsentDays: number;
  totalAmount: number;
  reconciledAmount: number;
  outstandingAmount: number;
};

/** ประกอบมุมมอง reconcile (pure): สรุปต่อช่องทาง + รายวัน จาก POS + config + สถานะที่ส่งไปแล้ว */
function buildView(
  days: SavedTeaDay[],
  configs: TeaChannelConfig[],
  status: Record<string, TeaReconcileCell>,
  branchCode: string,
): { summary: ChannelSummary[]; days: DayRow[] } {
  const configByCode = new Map(configs.map((c) => [c.code, c]));
  const summaryMap = new Map<string, ChannelSummary>();
  const rows: DayRow[] = [];
  for (const d of [...days].sort((a, b) => a.sales_date.localeCompare(b.sales_date))) {
    const { perChannel } = computeTeaSettlement(d.pos_channels ?? null, configByCode);
    const cells: DayCell[] = [];
    for (const ch of perChannel) {
      if (!ch.settled || !(ch.net > 0)) continue; // เฉพาะช่องที่เป็นเงินเข้าธนาคาร + มียอด
      const st = status[`tea:${branchCode}:${d.sales_date}:${ch.code}`];
      const state: CellState = !st ? "unsent" : st.reconciled ? "reconciled" : "pending";
      // ส่งแล้ว → ใช้ยอดที่อยู่ใน ledger จริง (กันยอดเพี้ยนถ้า POS ถูกแก้หลังส่ง)
      const amount = st ? st.amount : ch.net;
      cells.push({ channel: ch.code, amount, state });

      const s =
        summaryMap.get(ch.code) ??
        {
          channel: ch.code,
          label: ch.label,
          daysWithDeposit: 0,
          reconciledDays: 0,
          pendingDays: 0,
          unsentDays: 0,
          totalAmount: 0,
          reconciledAmount: 0,
          outstandingAmount: 0,
        };
      s.daysWithDeposit += 1;
      s.totalAmount += amount;
      if (state === "reconciled") {
        s.reconciledDays += 1;
        s.reconciledAmount += amount;
      } else {
        if (state === "pending") s.pendingDays += 1;
        else s.unsentDays += 1;
        s.outstandingAmount += amount;
      }
      summaryMap.set(ch.code, s);
    }
    if (cells.length) rows.push({ day: Number(d.sales_date.slice(8, 10)), date: d.sales_date, cells });
  }
  return { summary: [...summaryMap.values()], days: rows };
}

export function TeaReconcilePanel({
  branchCode,
  branchLabel,
  month,
  configured,
  canSend,
  days,
  configs,
  status,
  branches,
  onBranchChange,
}: {
  branchCode: string;
  branchLabel: string;
  month: string; // "2026-04"
  configured: boolean;
  canSend: boolean;
  days: SavedTeaDay[];
  configs: TeaChannelConfig[];
  status: Record<string, TeaReconcileCell>;
  branches?: { code: string; label: string }[]; // ถ้ามี → โชว์ช่องเลือกสาขาในแผง (ใช้ตอนโชว์ทุกแท็บ)
  onBranchChange?: (code: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDays, setShowDays] = useState(false);

  const { summary, days: dayRows } = useMemo(
    () => buildView(days, configs, status, branchCode),
    [days, configs, status, branchCode],
  );

  async function send() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const [y, m] = month.split("-").map(Number);
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const r = await fetch("/api/cashhub/tea/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchCode, from, to }),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "ส่งไม่สำเร็จ");
      setMsg(
        `✅ ส่งเข้าระบบบัญชีแล้ว ${j.inserted} รายการ${j.skippedNoConfig ? ` · ข้าม ${j.skippedNoConfig} (ยังไม่ผูกบัญชี)` : ""} → ไปกระทบยอดที่หน้าบัญชีธนาคาร`,
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
  const hasDeposits = summary.length > 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-zinc-800">🏦 กระทบยอดธนาคาร (reconcile){!branches && ` · ${branchLabel}`}</div>
          <div className="text-xs text-zinc-500">
            ส่งยอดเข้าจริง (หักค่าธรรมเนียมแล้ว) เข้าระบบบัญชี → นักบัญชีกระทบกับ statement → 🟢 เขียวเมื่อกระทบแล้ว
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {branches && onBranchChange && (
            <select
              value={branchCode}
              onChange={(e) => onBranchChange(e.target.value)}
              aria-label="เลือกสาขาที่จะส่งเข้ากระทบยอด"
              title="เลือกสาขา"
              className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium max-w-[180px]"
            >
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.label}
                </option>
              ))}
            </select>
          )}
          {canSend && (
            <button
              type="button"
              onClick={send}
              disabled={busy || !configured || !hasDeposits}
              className="h-9 px-4 rounded-xl bg-[var(--ch-navy,#0b1850)] text-white text-sm font-semibold disabled:opacity-50 shrink-0"
            >
              {busy ? "กำลังส่ง…" : "ส่งเข้าระบบบัญชี"}
            </button>
          )}
        </div>
      </div>

      {!configured && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-2.5">
          ⚠️ ยังไม่ได้ตั้งค่าช่องทาง→บัญชี — กด “⚙ ตั้งค่าบัญชี (Reconcile)” ด้านบนก่อน
        </div>
      )}
      {configured && !hasDeposits && (
        <div className="rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-500 text-sm p-2.5">
          ยังไม่มียอดเข้าธนาคารเดือนนี้ — อัปไฟล์ Foodstory เพื่อให้มียอดแยกช่องทาง (เงินสด/QR/…)
        </div>
      )}
      {msg && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-2.5">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-2.5">{err}</div>
      )}

      {hasDeposits && (
        <>
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
                    <span className={`text-xs font-bold tabular-nums ${allGood ? "text-matched-iridescent" : ""}`}>
                      {s.reconciledDays}/{s.daysWithDeposit} วัน {allGood ? "✦" : ""}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3">
                    <span>🟢 กระทบ {s.reconciledDays}</span>
                    <span>🟡 รอ {s.pendingDays}</span>
                    <span>⚪ ยังไม่ส่ง {s.unsentDays}</span>
                  </div>
                  <div className="text-xs mt-1.5 tabular-nums">
                    <span className={allGood ? "text-matched-iridescent font-semibold" : "text-emerald-700 font-semibold"}>
                      กระทบแล้ว {formatBaht(s.reconciledAmount)}
                    </span>
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
            {dayRows.length > 0 && (
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
            <div className="overflow-x-auto rounded-xl border border-zinc-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 text-xs">
                    <th className="px-2.5 py-1.5 text-left font-semibold">วันที่</th>
                    {summary.map((s) => (
                      <th key={s.channel} className="px-2.5 py-1.5 text-right font-semibold whitespace-nowrap">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((d) => (
                    <tr key={d.date} className="border-t border-zinc-50">
                      <td className="px-2.5 py-1.5 font-semibold text-zinc-700">{d.day}</td>
                      {summary.map((s) => {
                        const cell = d.cells.find((c) => c.channel === s.channel);
                        if (!cell)
                          return <td key={s.channel} className="px-2.5 py-1.5 text-right text-zinc-300">—</td>;
                        const recon = cell.state === "reconciled";
                        return (
                          <td
                            key={s.channel}
                            className={`px-2.5 py-1.5 text-right tabular-nums ${recon ? "cell-matched-iridescent" : STATE_TEXT[cell.state]}`}
                          >
                            {recon ? "✦" : DOT[cell.state]} {formatBaht(cell.amount)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-zinc-400">
        <span className="cell-matched-iridescent rounded px-1">✦ สีรุ้ง</span> = นักบัญชีกระทบกับ statement
        ธนาคารจริงแล้ว · 🟡 = ส่งเข้าระบบแล้ว รอ statement มากระทบ · ⚪ = ยังไม่ส่งเข้าระบบ ·
        ยอดที่ส่ง = หักค่าธรรมเนียมแต่ละช่องทางแล้ว (เช่น Grab) ตามที่ตั้งใน “⚙ ตั้งค่าบัญชี”
      </p>
    </div>
  );
}
