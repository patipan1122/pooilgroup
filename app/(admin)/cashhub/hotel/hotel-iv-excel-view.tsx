"use client";

// หน้า B — แสดงตาราง Excel โดยเติมข้อมูลจาก "IV TRCloud" (ดึงสด ไม่เขียน DB)
// ตารางเดียวกับหน้า Sheet แต่ยอดขายมาจาก IV → ไว้เทียบว่าตรงกันไหม
import { useState } from "react";
import { formatBaht } from "@/lib/utils/format";
import { groupByDay, type HotelShiftRow } from "@/lib/cashhub/hotel";
import { HotelExcelGrid } from "./hotel-excel-grid";

type ShiftIv = { ivNo: string; total: number; status: string };
type Day = { day: number; morning: ShiftIv | null; evening: ShiftIv | null };
type Resp = {
  summary: {
    ivCount: number;
    expectedShifts: number;
    missingShifts: number;
    ivTotal: number;
  };
  days: Day[];
};

export function HotelIvExcelView({
  branchId,
  month,
}: {
  branchId: string | null;
  month: string;
}) {
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
      if (!res.ok) return setErr(json.error ?? "ดึงไม่สำเร็จ");
      setData(json as Resp);
    } catch {
      setErr("เชื่อมต่อ TRCloud ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  // แปลง IV → แถวแบบ HotelShiftRow (เติมเฉพาะ total_sales จาก IV, ที่เหลือว่าง)
  const [yy, mm] = month.split("-").map(Number);
  const rows: HotelShiftRow[] = [];
  if (data) {
    for (const d of data.days) {
      const date = `${yy}-${String(mm).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
      const mk = (sh: "morning" | "evening", iv: ShiftIv | null) => {
        if (!iv) return;
        rows.push({
          id: `${date}-${sh}`,
          sales_date: date,
          shift: sh,
          rooms: null, room_revenue: null, fine: null, tip: null,
          goods_sales: null, total_sales: iv.total,
          cash_to_remit: null, cash_pool: null, cash_deposited: null,
          cash_diff: null, advance: null,
          qr_morning: null, qr_after2330: null, qr_total: null,
          qr_banked: null, qr_diff: null,
          ota_agoda: null, ota_agoda_banked: null, ota_expedia: null,
          ota_expedia_banked: null, ota_booking: null, ota_booking_banked: null,
          staff_name: iv.status === "Paid" ? "จ่ายแล้ว" : "ค้าง",
          note: `IV #${iv.ivNo}`, over_short: null,
        });
      };
      mk("morning", d.morning);
      mk("evening", d.evening);
    }
  }
  const days = groupByDay(rows);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-zinc-800">ตาราง Excel จาก IV (TRCloud)</div>
          <div className="text-xs text-zinc-500">
            ยอดขายดึงจาก IV ที่หน้างานคีย์ · ช่องอื่น (QR/OTA/เงินสด) IV ไม่มี → ว่างไว้
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
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-2.5">
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="IV คีย์แล้ว" value={`${data.summary.ivCount}`} />
            <Stat label="ควรมี (กะ)" value={`${data.summary.expectedShifts}`} />
            <Stat
              label="ยังไม่คีย์ (กะ)"
              value={`${data.summary.missingShifts}`}
              danger={data.summary.missingShifts > 0}
            />
            <Stat label="ยอดขายรวม (IV)" value={formatBaht(data.summary.ivTotal)} />
          </div>
          {data.summary.missingShifts > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-2.5">
              ⚠️ {data.summary.missingShifts} กะยังไม่มี IV — ตารางจะมีเฉพาะวันที่คีย์ IV แล้ว
            </div>
          )}
          {days.some((d) => d.hasData) ? (
            <HotelExcelGrid days={days} />
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
              เดือนนี้ยังไม่มี IV ใน TRCloud
            </div>
          )}
        </>
      )}

      {!data && !busy && (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
          กด “ดึง IV เดือนนี้” เพื่อแสดงตาราง Excel จากข้อมูล IV
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
        className={`font-bold tabular-nums text-sm ${danger ? "text-red-700" : "text-zinc-900"}`}
      >
        {value}
      </div>
    </div>
  );
}
