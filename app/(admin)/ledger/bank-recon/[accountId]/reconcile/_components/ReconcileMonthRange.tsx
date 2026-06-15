"use client";

// ตัวเลือก "ช่วงเดือน" — ดูได้หลายเดือนพร้อมกัน (เดือนเริ่ม → เดือนจบ) สำหรับกระทบยอด statement ที่คร่อมหลายเดือน.
// query ยัง bounded ตามช่วงที่เลือก (เร็ว) — ไม่ใช่ดึงทั้งหมด.

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_TH[m - 1] ?? m} ${y + 543}`;
}

export function ReconcileMonthRange({ from, to, options }: { from: string; to: string; options: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  const go = (nf: string, nt: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set("period", nf);
    p.set("periodTo", nt);
    router.push(`${pathname}?${p.toString()}`);
  };
  const selCls = "rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";
  return (
    <div className="flex items-center gap-1.5">
      <select aria-label="เดือนเริ่ม" value={from} onChange={(e) => { const v = e.target.value; go(v, v > to ? v : to); }} className={selCls}>
        {options.map((o) => <option key={o} value={o}>{monthLabel(o)}</option>)}
      </select>
      <span className="text-xs text-zinc-400">ถึง</span>
      <select aria-label="เดือนจบ" value={to} onChange={(e) => { const v = e.target.value; go(v < from ? v : from, v); }} className={selCls}>
        {options.map((o) => <option key={o} value={o}>{monthLabel(o)}</option>)}
      </select>
    </div>
  );
}
