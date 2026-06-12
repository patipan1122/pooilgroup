"use client";

// RevenueManager — list/add/delete revenue entries (หน้าจัดการรายได้).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, TrendingUp, Download } from "lucide-react";
import {
  addRevenueEntryAction, deleteRevenueEntryAction,
  previewRevenueRangeAction, syncRevenueRangeAction,
} from "../../_actions";
import { REVENUE_CHANNELS, REVENUE_CHANNEL_LABELS } from "@/lib/ledger/revenue-channel-types";
import type { TrcloudRevenuePreviewRow } from "@/lib/ledger/trcloud-revenue";

interface Entry {
  id: string; entryDate: string; amountSatang: number; sourceType: string;
  sourceRef: string | null; description: string | null; customerName: string | null;
  matchState: string; inGroup: boolean;
}
interface Props {
  companyId: string;
  canEdit: boolean;
  entries: Entry[];
  period: string;
  periodLabel: string;
  prevPeriod: string;
  nextPeriod: string | null;
  glOn: boolean;
}

// First + last day of a "YYYY-MM" period (default range for the TRCloud pull).
function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const SOURCE: Record<string, string> = {
  TRCLOUD_IV: "TRCloud", CHAIROPS: "ChairOps", CLAWFLEET: "ClawFleet",
  FUELOS: "FuelOS", WEBHOOK: "Webhook", MANUAL: "บันทึกเอง",
};

function baht(s: number) {
  return (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RevenueManager({ companyId, canEdit, entries, period, periodLabel, prevPeriod, nextPeriod, glOn }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showTrcloud, setShowTrcloud] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = (p: string) => router.push(`?company=${companyId}&period=${p}`);

  const del = (id: string) => {
    if (!window.confirm("ลบรายการรายได้นี้?")) return;
    setErr(null);
    start(async () => {
      const r = await deleteRevenueEntryAction(id);
      if (r.ok) router.refresh(); else setErr(r.error ?? "ลบไม่สำเร็จ");
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(prevPeriod)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">←</button>
          <span className="text-sm font-semibold text-zinc-800">{periodLabel}</span>
          {nextPeriod
            ? <button type="button" onClick={() => go(nextPeriod)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">→</button>
            : <span className="rounded-lg border border-zinc-100 px-3 py-1.5 text-sm text-zinc-300">→</span>}
        </div>
        {canEdit && !glOn && (
          <button type="button" onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus size={16} /> เพิ่มรายได้
          </button>
        )}
        {canEdit && glOn && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowTrcloud((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              <Download size={16} /> ดึงจาก TRCloud
            </button>
            <button type="button" onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={16} /> เพิ่มรายได้
            </button>
          </div>
        )}
      </div>

      {glOn && canEdit && showTrcloud && (
        <TrcloudPanel companyId={companyId} period={period}
          onClose={() => setShowTrcloud(false)}
          onImported={() => router.refresh()} />
      )}

      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-16 text-center">
          <TrendingUp size={28} className="mx-auto mb-2 text-zinc-300" />
          <p className="text-sm text-zinc-600">ยังไม่มีรายได้ในงวดนี้</p>
          <p className="mt-1 text-xs text-zinc-400">กด “เพิ่มรายได้” หรือดึงจาก TRCloud ในหน้ากระทบยอด</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">ที่มา</th>
                <th className="px-4 py-3">รายละเอียด</th>
                <th className="px-4 py-3 text-right">จำนวนเงิน</th>
                <th className="px-4 py-3 text-center">สถานะ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 text-zinc-500">{e.entryDate}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                      {SOURCE[e.sourceType] ?? e.sourceType}
                    </span>
                    {e.sourceRef && <span className="ml-1 text-xs text-zinc-400">{e.sourceRef}</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 max-w-[240px] truncate">
                    {e.description || e.customerName || "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-600">+฿{baht(e.amountSatang)}</td>
                  <td className="px-4 py-3 text-center">
                    {(e.matchState === "matched" || e.inGroup) ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">กระทบแล้ว</span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">ยังไม่กระทบ</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && !(e.matchState === "matched" || e.inGroup) && (
                      <button type="button" onClick={() => del(e.id)} disabled={pending}
                        aria-label="ลบ"
                        className="text-zinc-400 hover:text-rose-600 disabled:opacity-50">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddModal companyId={companyId} glOn={glOn} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); router.refresh(); }} />
      )}
    </div>
  );
}

function AddModal({ companyId, glOn, onClose, onDone }: { companyId: string; glOn: boolean; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [customer, setCustomer] = useState("");
  const [channel, setChannel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDup, setConfirmDup] = useState(false); // inline near-duplicate confirm panel

  const save = (force: boolean) => {
    const n = Math.round(parseFloat(amount) * 100);
    if (!date || isNaN(n) || n <= 0) { setErr("กรอกวันที่และจำนวนเงินให้ถูกต้อง"); return; }
    setErr(null);
    start(async () => {
      const r = await addRevenueEntryAction({
        companyId, entryDate: date, amountSatang: n, description: desc,
        customerName: customer || undefined,
        channelCode: glOn && channel ? channel : undefined,
        force,
      });
      if (r.ok) { onDone(); return; }
      if (r.duplicate) { setConfirmDup(true); return; }
      setErr(r.error ?? "บันทึกไม่สำเร็จ");
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-800">เพิ่มรายได้</h3>
          <button type="button" aria-label="ปิด" onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X size={20} /></button>
        </div>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">วันที่</span>
          <input aria-label="วันที่" type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirmDup(false); }} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">จำนวนเงิน (บาท)</span>
          <input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirmDup(false); }} placeholder="0.00" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        {glOn && (
          <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">ช่องทาง</span>
            <select aria-label="ช่องทาง" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
              <option value="">— เลือกช่องทาง —</option>
              {REVENUE_CHANNELS.map((c) => (
                <option key={c} value={c}>{REVENUE_CHANNEL_LABELS[c]}</option>
              ))}
            </select></label>
        )}
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">รายละเอียด</span>
          <input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ขายหน้าร้าน" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">ลูกค้า (ถ้ามี)</span>
          <input aria-label="ลูกค้า" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ชื่อลูกค้า" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        {confirmDup ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">มีรายได้จำนวนเท่ากันในวันเดียวกันแล้ว — ยืนยันเพิ่มซ้ำ?</p>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDup(false)} disabled={pending} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-50">ยกเลิก</button>
              <button type="button" onClick={() => save(true)} disabled={pending} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "ยืนยันเพิ่ม"}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50">ยกเลิก</button>
            <button type="button" onClick={() => save(false)} disabled={pending} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TRCloud preview/select panel (diff-before-write) ────────────────────────────
// "เลือกดึงให้ถูก": preview the IV revenue for a range, tick the NEW+valid rows,
// then import only the selected docNos.
function TrcloudPanel({ companyId, period, onClose, onImported }: {
  companyId: string; period: string; onClose: () => void; onImported: () => void;
}) {
  const init = periodRange(period);
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(init.start);
  const [to, setTo] = useState(init.end);
  const [rows, setRows] = useState<TrcloudRevenuePreviewRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const preview = () => {
    setErr(null); setResult(null); setRows(null);
    start(async () => {
      const r = await previewRevenueRangeAction({ companyId, periodStart: from, periodEnd: to });
      if (!r.ok || !r.rows) { setErr(r.error ?? "ดึงรายการไม่สำเร็จ"); return; }
      setRows(r.rows);
      // default-check only new + valid rows
      setPicked(new Set(r.rows.filter((x) => x.isNew && x.valid).map((x) => x.docNo)));
    });
  };

  const toggle = (docNo: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(docNo)) next.delete(docNo); else next.add(docNo);
      return next;
    });
  };

  const doImport = () => {
    setErr(null);
    start(async () => {
      const r = await syncRevenueRangeAction({ companyId, periodStart: from, periodEnd: to, selectedDocNos: [...picked] });
      if (!r.ok) { setErr(r.error ?? "นำเข้าไม่สำเร็จ"); return; }
      setResult({ inserted: r.inserted ?? 0, skipped: r.skipped ?? 0 });
      onImported();
    });
  };

  const newCount = rows ? rows.filter((x) => x.isNew && x.valid).length : 0;

  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">ดึงรายได้จาก TRCloud</h3>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X size={18} /></button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">ตั้งแต่</span>
          <input aria-label="ตั้งแต่" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">ถึง</span>
          <input aria-label="ถึง" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <button type="button" onClick={preview} disabled={pending} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50">{pending ? "กำลังดึง…" : "ดูรายการ"}</button>
      </div>

      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
      {result && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          นำเข้าแล้ว {result.inserted} รายการ{result.skipped > 0 ? ` · ข้าม ${result.skipped} รายการ` : ""}
        </p>
      )}

      {rows && !result && (
        rows.length === 0 ? (
          <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500">ไม่พบรายการในช่วงวันที่นี้</p>
        ) : (
          <>
            <p className="mt-3 text-xs text-zinc-500">เลือก {picked.size} จาก {newCount} ใหม่</p>
            <div className="mt-2 max-h-72 divide-y divide-zinc-50 overflow-y-auto rounded-lg border border-zinc-100">
              {rows.map((r) => {
                const disabled = !r.isNew || !r.valid;
                return (
                  <label key={r.docNo} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${disabled ? "bg-zinc-50/50" : "hover:bg-zinc-50"}`}>
                    <input type="checkbox" aria-label={`เลือก ${r.docNo}`} checked={picked.has(r.docNo)} disabled={disabled || pending}
                      onChange={() => toggle(r.docNo)} className="h-4 w-4 shrink-0 disabled:opacity-40" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-700">{r.docNo}</span>
                        {!r.valid
                          ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">⚠️ ข้อมูลไม่ครบ</span>
                          : r.isNew
                            ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">🆕 ใหม่</span>
                            : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">นำเข้าแล้ว</span>}
                      </div>
                      <div className="truncate text-xs text-zinc-400">
                        {r.docDate ?? "—"} · {r.customerName || "ไม่ระบุลูกค้า"} · {r.channelCode ? REVENUE_CHANNEL_LABELS[r.channelCode] : "ไม่ระบุ"}
                      </div>
                    </div>
                    <span className="shrink-0 font-semibold text-emerald-600">+฿{baht(r.amountSatang)}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={doImport} disabled={pending || picked.size === 0}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {pending ? "กำลังนำเข้า…" : `นำเข้า ${picked.size} รายการ`}
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
