"use client";

// ตารางเต็มแบบ Excel ต่อสาขา — ตรึงหัว+คอลัมน์วันที่, แยกทุกช่องทาง, IV (TRC), ส่วนต่างแดงถ้า≠0,
// แถวรวมท้าย. มิเรอร์สไตล์ amazon-excel-grid. ใช้ "ดูทาน" ก่อนส่ง reconcile. 1 วัน = 1 แถว.
import { formatBaht } from "@/lib/utils/format";
import type { SavedTeaDay } from "@/lib/cashhub/tea-data";
import { TEA_CHANNELS, type TeaChannelCode } from "@/lib/cashhub/tea-channels";

const cell = (v: number | null | undefined) =>
  v == null ? "" : Math.abs(v) < 0.005 ? "0" : formatBaht(v);

type Props = {
  branchLabel: string;
  days: string[]; // ทุกวันในเดือน (YYYY-MM-DD)
  byDate: Map<string, SavedTeaDay>; // วัน → ข้อมูล (สาขานี้)
};

export function TeaExcelGrid({ branchLabel, days, byDate }: Props) {
  const channelCols = TEA_CHANNELS; // ลำดับ = สมุดบัญชี

  // รวมท้าย
  const tot = {
    pos: 0,
    iv: 0,
    before: 0,
    vat: 0,
    ch: {} as Record<string, number>,
  };
  for (const d of byDate.values()) {
    tot.pos += d.pos_gross ?? 0;
    tot.iv += d.iv_gross ?? 0;
    tot.before += d.iv_total ?? 0;
    tot.vat += d.iv_vat ?? 0;
    for (const c of channelCols) tot.ch[c.code] = (tot.ch[c.code] ?? 0) + (d.pos_channels?.[c.code] ?? 0);
  }
  const totDiff = tot.iv - tot.pos;

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-50 text-zinc-600">
            <th className="sticky left-0 z-10 bg-zinc-50 px-2.5 py-2 text-left font-semibold border-b border-zinc-200">
              วันที่
            </th>
            <th className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 bg-zinc-100/60">
              ยอดขาย POS
            </th>
            {channelCols.map((c) => (
              <th
                key={c.code}
                className="px-2.5 py-2 text-right font-medium border-b border-zinc-200 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
            <th className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 bg-blue-50/60 whitespace-nowrap">
              IV (TRC)
            </th>
            <th className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 whitespace-nowrap">
              ส่วนต่าง
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((date) => {
            const d = byDate.get(date);
            const pos = d?.pos_gross ?? null;
            const iv = d?.iv_gross ?? null;
            const diff = iv != null && pos != null ? iv - pos : null;
            const diffBad = diff != null && Math.abs(diff) >= 1;
            const noIv = pos != null && iv == null; // มียอด POS แต่ยังไม่คีย์ IV → ต้องตาม
            return (
              <tr key={date} className="hover:bg-zinc-50/60">
                <td className="sticky left-0 z-10 bg-white px-2.5 py-1.5 font-medium text-zinc-700 border-b border-zinc-100">
                  {Number(date.slice(8, 10))}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-zinc-800 border-b border-zinc-100 bg-zinc-50/60">
                  {cell(pos)}
                </td>
                {channelCols.map((c) => {
                  const v = d?.pos_channels?.[c.code as TeaChannelCode] ?? null;
                  return (
                    <td
                      key={c.code}
                      className="px-2.5 py-1.5 text-right tabular-nums text-zinc-500 border-b border-zinc-100"
                    >
                      {v ? cell(v) : <span className="text-zinc-300">·</span>}
                    </td>
                  );
                })}
                <td
                  className={`px-2.5 py-1.5 text-right tabular-nums font-medium border-b border-zinc-100 ${
                    noIv ? "bg-amber-50 text-amber-700" : "text-blue-700 bg-blue-50/40"
                  }`}
                >
                  {iv != null ? cell(iv) : noIv ? "ยังไม่คีย์" : <span className="text-zinc-300">—</span>}
                </td>
                <td
                  className={`px-2.5 py-1.5 text-right tabular-nums border-b border-zinc-100 ${
                    diffBad
                      ? "bg-red-50 text-red-700 font-semibold"
                      : noIv
                        ? "bg-amber-50 text-amber-700"
                        : "text-zinc-400"
                  }`}
                >
                  {diff != null ? (Math.abs(diff) < 0.5 ? "0" : cell(diff)) : noIv ? "⚪" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-100 font-bold text-zinc-800">
            <td className="sticky left-0 z-10 bg-zinc-100 px-2.5 py-2">รวม</td>
            <td className="px-2.5 py-2 text-right tabular-nums">{cell(tot.pos)}</td>
            {channelCols.map((c) => (
              <td key={c.code} className="px-2.5 py-2 text-right tabular-nums text-zinc-600">
                {cell(tot.ch[c.code] ?? 0)}
              </td>
            ))}
            <td className="px-2.5 py-2 text-right tabular-nums text-blue-700 bg-blue-50/60">{cell(tot.iv)}</td>
            <td
              className={`px-2.5 py-2 text-right tabular-nums ${Math.abs(totDiff) >= 1 ? "text-red-700" : "text-zinc-500"}`}
            >
              {Math.abs(totDiff) < 0.5 ? "0" : cell(totDiff)}
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="px-3 py-2 text-xs text-zinc-400">
        {branchLabel} · ยอดขาย POS = รวมทุกช่องทาง (รวม VAT) เทียบกับ IV ที่คีย์ใน TRCloud · ส่วนต่างแดง =
        ต้องตรวจ
      </div>
    </div>
  );
}
