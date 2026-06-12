"use client";

// RevenueManager — list/add/delete revenue entries (หน้าจัดการรายได้).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, TrendingUp } from "lucide-react";
import { addRevenueEntryAction, deleteRevenueEntryAction } from "../../_actions";

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
}

const SOURCE: Record<string, string> = {
  TRCLOUD_IV: "TRCloud", CHAIROPS: "ChairOps", CLAWFLEET: "ClawFleet",
  FUELOS: "FuelOS", WEBHOOK: "Webhook", MANUAL: "บันทึกเอง",
};

function baht(s: number) {
  return (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RevenueManager({ companyId, canEdit, entries, period, periodLabel, prevPeriod, nextPeriod }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
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
        {canEdit && (
          <button type="button" onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus size={16} /> เพิ่มรายได้
          </button>
        )}
      </div>

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
        <AddModal companyId={companyId} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); router.refresh(); }} />
      )}
    </div>
  );
}

function AddModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [customer, setCustomer] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const n = Math.round(parseFloat(amount) * 100);
    if (!date || isNaN(n) || n <= 0) { setErr("กรอกวันที่และจำนวนเงินให้ถูกต้อง"); return; }
    start(async () => {
      const r = await addRevenueEntryAction({ companyId, entryDate: date, amountSatang: n, description: desc, customerName: customer || undefined });
      if (r.ok) onDone(); else setErr(r.error ?? "บันทึกไม่สำเร็จ");
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
          <input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">จำนวนเงิน (บาท)</span>
          <input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">รายละเอียด</span>
          <input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ขายหน้าร้าน" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">ลูกค้า (ถ้ามี)</span>
          <input aria-label="ลูกค้า" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ชื่อลูกค้า" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50">ยกเลิก</button>
          <button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        </div>
      </div>
    </div>
  );
}
