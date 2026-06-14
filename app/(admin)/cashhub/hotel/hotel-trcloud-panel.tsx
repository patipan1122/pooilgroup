"use client";

// แผงดึง IV จาก TRCloud — เช็คว่าหน้างานคีย์ IV ครบทุกวัน/กะไหม + ยอดตรง Excel ไหม
import { useState } from "react";
import { formatBaht } from "@/lib/utils/format";

type ShiftIv = {
  ivNo: string;
  total: number;
  status: string;
  excel: number | null;
  match: boolean | null;
};
type Day = { day: number; morning: ShiftIv | null; evening: ShiftIv | null };
type Resp = {
  summary: {
    ivCount: number;
    expectedShifts: number;
    missingShifts: number;
    unknownShift: number;
    ivTotal: number;
  };
  days: Day[];
};

export function HotelTrcloudPanel({
  branchId,
  month,
}: {
  branchId: string | null;
  month: string; // YYYY-MM
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Resp | null>(null);

  async function pull() {
    setBusy(true);
    setErr(null);
    try {
      const [y, m] = month.split("-").map(Number);
      const res = await fetch("/api/cashhub/hotel/trcloud-pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: y, month: m, branchId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "ดึงไม่สำเร็จ");
        return;
      }
      setData(json as Resp);
      setOpen(true);
    } catch {
      setErr("เชื่อมต่อ TRCloud ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  const cell = (s: ShiftIv | null) => {
    if (!s)
      return <span className="text-red-500 font-semibold">🔴 ไม่มี IV</span>;
    const m =
      s.match === null ? null : s.match ? (
        <span className="text-emerald-600">✓ ตรง Excel</span>
      ) : (
        <span className="text-amber-600">≠ Excel</span>
      );
    return (
      <span className="tabular-nums">
        {formatBaht(s.total)}{" "}
        <span className="text-zinc-400 text-[10px]">#{s.ivNo}</span>{" "}
        {s.status === "Paid" ? (
          <span className="text-emerald-600 text-[10px]">จ่ายแล้ว</span>
        ) : (
          <span className="text-zinc-400 text-[10px]">ค้าง</span>
        )}{" "}
        {m}
      </span>
    );
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-zinc-800">ดึง IV จาก TRCloud</div>
          <div className="text-xs text-zinc-500">
            เช็คว่าหน้างานคีย์ IV ครบทุกวัน/กะไหม (ยอด IV = ยอดขายในชีต)
          </div>
        </div>
        <button
          type="button"
          onClick={pull}
          disabled={busy}
          className="h-9 px-4 rounded-xl bg-[var(--ch-navy,#0b1850)] text-white text-sm font-semibold disabled:opacity-50 shrink-0"
        >
          {busy ? "กำลังดึง…" : "ดึง IV เดือนนี้"}
        </button>
      </div>

      {err && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-2.5">
          {err}
        </div>
      )}

      {data && open && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="IV ที่คีย์แล้ว" value={`${data.summary.ivCount}`} />
            <Stat
              label="ควรมี (กะ)"
              value={`${data.summary.expectedShifts}`}
            />
            <Stat
              label="ยังไม่คีย์ (กะ)"
              value={`${data.summary.missingShifts}`}
              danger={data.summary.missingShifts > 0}
            />
            <Stat label="ยอด IV รวม" value={formatBaht(data.summary.ivTotal)} />
          </div>
          {data.summary.missingShifts > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-2.5">
              ⚠️ มี {data.summary.missingShifts} กะที่ยังไม่มี IV ใน TRCloud —
              หน้างานอาจลืมคีย์ (ดูแถวที่ขึ้น 🔴 ด้านล่าง)
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-zinc-100">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">วันที่</th>
                  <th className="text-left px-2 py-1.5 font-semibold">กะเช้า</th>
                  <th className="text-left px-2 py-1.5 font-semibold">กะดึก</th>
                </tr>
              </thead>
              <tbody>
                {data.days
                  .filter((d) => d.morning || d.evening)
                  .map((d) => (
                    <tr key={d.day} className="border-b border-zinc-50">
                      <td className="px-2 py-1.5 font-semibold text-zinc-700">
                        {d.day}
                      </td>
                      <td className="px-2 py-1.5">{cell(d.morning)}</td>
                      <td className="px-2 py-1.5">{cell(d.evening)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-400">
            อ่านอย่างเดียว · ขั้นต่อไป: กดเขียนยอดขายจาก IV เข้า Excel อัตโนมัติ
            (รออนุมัติเปิดใช้)
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-xl p-2.5 ${danger ? "bg-red-50" : "bg-zinc-50"}`}>
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div
        className={`font-bold tabular-nums text-sm ${
          danger ? "text-red-700" : "text-zinc-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
