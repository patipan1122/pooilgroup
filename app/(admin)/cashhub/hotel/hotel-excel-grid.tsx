"use client";

// ตารางเต็มแบบ Excel — มิเรอร์ชีต Google รายวันของโรงแรม (1 วัน = 2 แถว เช้า/ค่ำ)
// ครบทุกช่อง ("ไส้ใน") + แถวรวมท้ายตาราง + ไฮไลต์ช่องที่ผิด (ส่วนต่าง ≠ 0)
import { formatBaht } from "@/lib/utils/format";
import type { HotelDay, HotelShiftRow } from "@/lib/cashhub/hotel";
import { reconDiffKind } from "@/lib/cashhub/recon-diff";

const num = (v: number | null | undefined) =>
  v == null ? "" : Math.abs(v) < 0.005 ? "0" : formatBaht(v);

type Col = {
  label: string;
  get: (r: HotelShiftRow) => number | null;
  f?: boolean; // ช่องคำนวณ (สูตร)
  diff?: boolean; // ไฮไลต์แดงถ้า ≠ 0
};

const COLS: Col[] = [
  { label: "ห้อง", get: (r) => r.rooms },
  { label: "ค่าห้อง", get: (r) => r.room_revenue },
  { label: "ค่าปรับ", get: (r) => r.fine },
  { label: "ทิป", get: (r) => r.tip },
  { label: "ขนม/ของ", get: (r) => r.goods_sales },
  { label: "ยอดขายรวม", get: (r) => r.total_sales, f: true },
  { label: "ส่งเงินสด", get: (r) => r.cash_to_remit, f: true },
  { label: "รวมเงินสด", get: (r) => r.cash_pool },
  { label: "เงินสดส่ง", get: (r) => r.cash_deposited },
  { label: "ต่างเงินสด", get: (r) => r.cash_diff, diff: true },
  { label: "QR เช้า", get: (r) => r.qr_morning },
  { label: "QR หลัง", get: (r) => r.qr_after2330 },
  { label: "รวม QR", get: (r) => r.qr_total },
  { label: "เข้าบัญชี", get: (r) => r.qr_banked },
  { label: "ต่าง QR", get: (r) => r.qr_diff, diff: true },
  { label: "agoda", get: (r) => r.ota_agoda },
  { label: "→เข้า", get: (r) => r.ota_agoda_banked },
  { label: "Expedia", get: (r) => r.ota_expedia },
  { label: "→เข้า", get: (r) => r.ota_expedia_banked },
  { label: "Booking", get: (r) => r.ota_booking },
  { label: "→เข้า", get: (r) => r.ota_booking_banked },
  { label: "เกิน/ขาด", get: (r) => r.over_short, diff: true },
];

export function HotelExcelGrid({ days }: { days: HotelDay[] }) {
  const data = days.filter((d) => d.hasData);
  // แถวรวมท้ายตาราง (sum ทุกแถว เช้า+ค่ำ)
  const totals = COLS.map((c) =>
    data.reduce(
      (s, d) =>
        s + (c.get(d.morning ?? ({} as HotelShiftRow)) ?? 0) +
        (c.get(d.evening ?? ({} as HotelShiftRow)) ?? 0),
      0,
    ),
  );

  const cell = (c: Col, r: HotelShiftRow | null) => {
    if (!r) return <td key={c.label} className="px-1.5 py-1 text-right text-zinc-300" />;
    const v = c.get(r);
    const bad = c.diff && v != null && Math.abs(v) >= 1;
    // ช่องส่วนต่าง (เกิน/ขาด · เงินสด/QR) ที่กระทบยอดเป๊ะ (|diff| ≤ ฿1) → สีรุ้ง
    const exact = c.diff && v != null && reconDiffKind(v) === "exact";
    return (
      <td
        key={c.label}
        className={`px-1.5 py-1 text-right tabular-nums whitespace-nowrap ${
          exact
            ? "cell-matched-iridescent"
            : bad
              ? "bg-red-100 font-bold text-red-800"
              : c.f
                ? "bg-blue-50/40 text-zinc-700"
                : "text-zinc-700"
        }`}
      >
        {num(v)}
      </td>
    );
  };

  return (
    <div className="space-y-2">
      <p className="lg:hidden mb-1.5 text-xs" style={{ color: "var(--ch-text-3)" }}>
        ปัด ←→ เพื่อดูเพิ่ม
      </p>
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden -mx-3 lg:mx-0">
        <div className="overflow-auto max-h-[72vh]">
          <table className="min-w-max text-[11px] border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-zinc-100 text-zinc-600">
                <th className="sticky left-0 z-30 bg-zinc-100 px-2 py-1.5 text-left font-semibold border-b border-zinc-200">
                  วันที่
                </th>
                <th className="sticky left-[42px] z-30 bg-zinc-100 px-2 py-1.5 text-left font-semibold border-b border-zinc-200">
                  กะ
                </th>
                {COLS.map((c) => (
                  <th
                    key={c.label}
                    className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap border-b border-zinc-200"
                  >
                    {c.f && <span className="text-blue-500">ƒ </span>}
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-left font-semibold border-b border-zinc-200 whitespace-nowrap">
                  คน
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const rowsOf: Array<["เช้า" | "ค่ำ", HotelShiftRow | null]> = [
                  ["เช้า", d.morning],
                  ["ค่ำ", d.evening],
                ];
                return rowsOf.map(([sh, r], i) => (
                  <tr
                    key={d.date + sh}
                    className={`border-b border-zinc-50 hover:bg-amber-50/40 ${
                      d.flagged ? "bg-red-50/30" : ""
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-white px-2 py-1 font-semibold text-zinc-800 border-r border-zinc-100">
                      {i === 0 ? d.day : ""}
                    </td>
                    <td className="sticky left-[42px] z-10 bg-white px-2 py-1 text-zinc-500 border-r border-zinc-100">
                      {sh}
                    </td>
                    {COLS.map((c) => cell(c, r))}
                    <td className="px-2 py-1 text-left text-zinc-500 whitespace-nowrap">
                      {r?.staff_name ?? ""}
                    </td>
                  </tr>
                ));
              })}
              {/* แถวรวม */}
              <tr className="sticky bottom-0 bg-zinc-900 text-white font-bold">
                <td className="sticky left-0 z-10 bg-zinc-900 px-2 py-1.5" colSpan={2}>
                  รวมเดือน
                </td>
                {totals.map((t, i) => (
                  <td key={i} className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {t !== 0 ? formatBaht(t) : ""}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-zinc-400">
        <span className="text-blue-500 font-semibold">ƒ</span> = ช่องคำนวณอัตโนมัติ ·
        ยอดขายรวม = ค่าห้อง+ค่าปรับ+ทิป+ขนม · ส่งเงินสด = ยอดขายรวม−QR−OTA ·
        ต่าง QR = เข้าบัญชี−รวม QR (≠0 = แดง) · เลื่อนซ้าย-ขวาดูครบทุกช่อง
      </p>
    </div>
  );
}
