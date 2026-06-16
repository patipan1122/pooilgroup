// LedgerLine — Coverage card: "กระทบยอดไปกี่ %" (count + ฿, แยกสถานะ + เงินเข้า/ออก).
// Presentational (no hooks) → ใช้ได้ทั้งหน้าบัญชี (ต่อบัญชี) และหน้าหลัก (รวมทุกบัญชี).
// 4 สถานะ: ยืนยัน/กระทบยอดแล้ว(เขียว · รวมโยกเงิน) · รอยืนยัน(เหลือง) · ข้าม(เทา) · ยังไม่จัดการ(แดง).

import type { ReconcileCoverage } from "@/lib/ledger/recon-controls";

function baht(satang: number): string {
  return (Math.abs(satang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Seg = { key: string; label: string; count: number; satang: number; bar: string; dot: string; text: string };

export function CoverageCard({
  coverage, title, subtitle, compact,
}: {
  coverage: ReconcileCoverage; title: string; subtitle?: string; compact?: boolean;
}) {
  const c = coverage;
  const segs: Seg[] = [
    { key: "confirmed", label: "ยืนยัน/กระทบยอดแล้ว", count: c.confirmed, satang: c.confirmedSatang, bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700" },
    { key: "suggested", label: "รอยืนยัน",            count: c.suggested, satang: c.suggestedSatang, bar: "bg-amber-400",   dot: "bg-amber-400",   text: "text-amber-700" },
    { key: "excluded",  label: "ข้าม / ไม่มีคู่",      count: c.excluded,  satang: c.excludedSatang,  bar: "bg-zinc-300",    dot: "bg-zinc-400",    text: "text-zinc-500" },
    { key: "unmatched", label: "ยังไม่จัดการ",         count: c.unmatched, satang: c.unmatchedSatang, bar: "bg-rose-400",    dot: "bg-rose-400",    text: "text-rose-700" },
  ];
  const w = (sat: number) => (c.totalSatang > 0 ? (sat / c.totalSatang) * 100 : 0);

  if (c.total === 0) {
    return (
      <div className="rounded-2xl border border-zinc-100 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-zinc-700">{title}</span>
          {subtitle && <span className="text-xs text-zinc-400">{subtitle}</span>}
        </div>
        <p className="mt-2 text-xs text-zinc-400">ยังไม่มีรายการธนาคารในช่วงนี้</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      {/* head: % เด่น (ตามยอดเงิน) */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-zinc-700">{title}</span>
          {subtitle && <span className="ml-2 text-xs text-zinc-400">{subtitle}</span>}
          <p className="mt-0.5 text-[11px] text-zinc-400">
            กระทบยอดแล้ว <b className="tabular-num text-emerald-600">{c.confirmedPctSatang}%</b> ของยอดเงิน
            {" · "}จัดการแล้ว <b className="tabular-num text-zinc-600">{c.handledPctSatang}%</b>
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold leading-none tabular-num text-emerald-600">{c.confirmedPctSatang}%</div>
          <div className="text-[10px] text-zinc-400">฿{baht(c.confirmedSatang)} / ฿{baht(c.totalSatang)}</div>
        </div>
      </div>

      {/* แถบ 4 สี (กว้างตามยอดเงิน) */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-100">
        {segs.map((s) => s.satang > 0 ? (
          <div key={s.key} className={`${s.bar} h-full transition-all`} style={{ width: `${w(s.satang)}%` }} title={`${s.label}: ฿${baht(s.satang)}`} />
        ) : null)}
      </div>

      {/* รายละเอียด 4 สถานะ: จำนวนรายการ + ยอดเงิน */}
      {!compact && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          {segs.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${s.dot}`} />
              <div className="min-w-0">
                <div className="truncate text-[11px] text-zinc-500">{s.label}</div>
                <div className="text-xs">
                  <span className={`font-semibold tabular-num ${s.text}`}>{s.count}</span>
                  <span className="text-zinc-400"> รายการ · ฿{baht(s.satang)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* footer: เงินเข้า / เงินออก ทั้งหมด */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-50 pt-2.5 text-xs">
        <span className="text-zinc-500">เงินเข้าทั้งหมด <b className="tabular-num text-emerald-600">฿{baht(c.inSatang)}</b> <span className="text-zinc-400">({c.inCount})</span></span>
        <span className="text-zinc-500">เงินออกทั้งหมด <b className="tabular-num text-rose-600">฿{baht(c.outSatang)}</b> <span className="text-zinc-400">({c.outCount})</span></span>
        {c.unmatched > 0 && (
          <span className="ml-auto rounded-full bg-rose-50 px-2.5 py-0.5 font-medium text-rose-600">
            เหลือ {c.unmatched} รายการ · ฿{baht(c.unmatchedSatang)}
          </span>
        )}
      </div>
    </div>
  );
}
