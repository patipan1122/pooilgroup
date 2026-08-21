"use client";

// ไส้ใน — รายบิลจริงของ (สาขา, วัน, ช่องทาง) เดียว เช่น QR วันที่ 1 ส.ค. แตกเป็น ฿19/฿24/฿34 ฯลฯ
// CEO ขอ: เงินเข้าจริงเป็นรายทรานเซกชัน อยากเห็นไส้ในก่อนเทียบกับยอดโอนธนาคาร (2026-08-21)
import { useEffect, useState } from "react";
import { formatBaht } from "@/lib/utils/format";

type Item = { channelCode: string; amountBaht: number; reportType: string; label: string };

export type TeaTransactionDetailTarget = {
  branchCode: string;
  branchLabel: string;
  date: string; // YYYY-MM-DD
  channelCode: string;
  channelLabel: string;
  posTotal: number; // ยอดรวมช่องทางนี้จากตาราง — ไว้เทียบกับผลรวมรายบิล
};

// key={branchCode:date:channelCode} จาก parent → ทุก target ใหม่ = mount instance ใหม่
// (แทนที่จะ reset state เองใน effect — ให้ React unmount/remount จัดการให้ ตาม pattern ที่แนะนำ
//  https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes)
export function TeaTransactionDetailModal({
  target,
  onClose,
}: {
  target: TeaTransactionDetailTarget;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/cashhub/tea/pos-transactions?branch=${encodeURIComponent(target.branchCode)}&date=${target.date}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; items?: Item[]; error?: string }) => {
        if (data.error) setErr(data.error);
        else setItems((data.items ?? []).filter((it) => it.channelCode === target.channelCode));
      })
      .catch(() => setErr("โหลดไม่สำเร็จ"));
    return () => ctrl.abort();
  }, [target]);

  const total = items?.reduce((s, it) => s + it.amountBaht, 0) ?? 0;
  const tieOut = items != null && Math.abs(total - target.posTotal) < 0.5;
  const reportType = items?.[0]?.reportType;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl bg-white shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-100 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-800">
              ไส้ใน {target.channelLabel} · {target.branchLabel}
            </div>
            <div className="text-xs text-zinc-400">{target.date}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="h-7 w-7 shrink-0 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            ✕
          </button>
        </div>

        {reportType === "detail" && (
          <div className="mx-4 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ⚠️ ไฟล์นี้เป็นรายงาน &quot;แยกตามรายละเอียดบิล&quot; (รายการเมนู) — 1 แถวอาจไม่ใช่ 1 ยอดโอนจริง
            ถ้าจะเทียบกับสเตทเมนต์ธนาคารทีละรายการ แนะนำอัปโหลด &quot;สรุปยอดขายแยกตามบิล&quot; แทน
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {err && <div className="text-sm text-red-600">{err}</div>}
          {!err && items == null && <div className="text-sm text-zinc-400">กำลังโหลด…</div>}
          {!err && items != null && items.length === 0 && (
            <div className="text-sm text-zinc-400">ไม่มีข้อมูลรายบิล (อาจอัปเป็นรายงานปิดสิ้นวันแบบสรุปยอดรวม)</div>
          )}
          {!err && items != null && items.length > 0 && (
            <ul className="divide-y divide-zinc-50">
              {items
                .slice()
                .sort((a, b) => b.amountBaht - a.amountBaht)
                .map((it, i) => (
                  <li key={i} className="flex items-center justify-between py-1.5 text-sm tabular-nums">
                    <span className="text-zinc-400">#{i + 1}</span>
                    <span className="font-medium text-zinc-800">{formatBaht(it.amountBaht)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {items != null && items.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-100 flex items-center justify-between text-sm">
            <span className="text-zinc-500">{items.length} รายการ · รวม</span>
            <span className={`font-semibold tabular-nums ${tieOut ? "text-emerald-700" : "text-amber-700"}`}>
              {formatBaht(total)}
              {!tieOut && <span className="ml-1 font-normal text-xs">(ตาราง {formatBaht(target.posTotal)})</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
