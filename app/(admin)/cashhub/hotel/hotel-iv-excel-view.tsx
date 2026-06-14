"use client";

// หน้า B — แสดงตาราง Excel โดยเติมข้อมูลจาก "IV TRCloud" (ดึงสด ไม่เขียน DB)
// ตารางเดียวกับหน้า Sheet แต่ยอดขายมาจาก IV → ไว้เทียบว่าตรงกันไหม
import { useState } from "react";
import { formatBaht } from "@/lib/utils/format";
import { groupByDay, TH_MONTHS, type HotelShiftRow } from "@/lib/cashhub/hotel";
import { HotelExcelGrid } from "./hotel-excel-grid";

type ShiftIv = {
  ivId: string;
  ivNo: string;
  total: number;
  status: string;
  cash: number;
  qr: number;
  over: number;
  short: number;
};
type Split = { room: number; tip: number; fine: number; goods: number };
type Day = { day: number; morning: ShiftIv | null; evening: ShiftIv | null };
type Resp = {
  availableMonths: string[];
  summary: {
    ivCount: number;
    expectedShifts: number;
    missingShifts: number;
    ivTotal: number;
  };
  days: Day[];
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${TH_MONTHS[(m || 1) - 1]} ${(y || 0) + 543}`;
}

export function HotelIvExcelView({
  branchId,
  month,
  initialRows = [],
  savedCount = 0,
}: {
  branchId: string | null;
  month: string;
  initialRows?: HotelShiftRow[]; // ข้อมูลที่บันทึกไว้ (อ่านจาก DB ตอนโหลด)
  savedCount?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [splits, setSplits] = useState<Record<string, Split>>({});
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);

  // รวม ivId ทั้งหมดของเดือน + ที่ยังไม่ดึง line items
  const allIds: string[] = [];
  if (data)
    for (const d of data.days) {
      if (d.morning?.ivId) allIds.push(d.morning.ivId);
      if (d.evening?.ivId) allIds.push(d.evening.ivId);
    }
  const remainIds = allIds.filter((id) => !splits[id]);

  async function enrich() {
    if (remainIds.length === 0 || !data) return;
    setEnriching(true);
    setEnrichNote(null);
    // วนเรียกทีละชุด (server cap 15/ครั้ง) จนครบทั้งเดือน — อัตโนมัติ
    const acc: Record<string, Split> = { ...splits };
    const all: string[] = [];
    for (const d of data.days) {
      if (d.morning?.ivId) all.push(d.morning.ivId);
      if (d.evening?.ivId) all.push(d.evening.ivId);
    }
    try {
      for (let guard = 0; guard < 20; guard++) {
        const missing = all.filter((id) => !acc[id]);
        if (missing.length === 0) break;
        const res = await fetch("/api/cashhub/hotel/iv-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: missing }),
        });
        const json = await res.json();
        if (!res.ok) {
          setEnrichNote(json.error ?? "ดึงรายละเอียดไม่สำเร็จ");
          break;
        }
        Object.assign(acc, json.splits);
        setSplits({ ...acc }); // เติมทีละชุดให้เห็นความคืบหน้า
        if (json.rateLimited) {
          setEnrichNote("TRCloud ติด rate-limit ชั่วคราว — กด “ดึงเพิ่ม” อีกครั้งใน 1 นาที");
          break;
        }
        if (Object.keys(json.splits).length === 0) break; // กันวนไม่จบ
      }
    } catch {
      setEnrichNote("เชื่อมต่อไม่ได้");
    } finally {
      setEnriching(false);
    }
  }

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function save() {
    if (!data) return;
    setSaving(true);
    setSavedMsg(null);
    const [yy2, mm2] = month.split("-").map(Number);
    const outRows: Array<Record<string, unknown>> = [];
    for (const d of data.days) {
      const date = `${yy2}-${String(mm2).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
      const mk = (sh: "morning" | "evening", iv: ShiftIv | null) => {
        if (!iv) return;
        const sp = splits[iv.ivId];
        outRows.push({
          date, shift: sh, total: iv.total, cash: iv.cash, qr: iv.qr,
          over: iv.over, short: iv.short, ivNo: iv.ivNo, status: iv.status,
          room: sp?.room ?? null, goods: sp?.goods ?? null,
          tip: sp?.tip ?? null, fine: sp?.fine ?? null,
        });
      };
      mk("morning", d.morning);
      mk("evening", d.evening);
    }
    try {
      const res = await fetch("/api/cashhub/hotel/iv-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, rows: outRows }),
      });
      const json = await res.json();
      setSavedMsg(
        res.ok ? `✅ บันทึกแล้ว ${json.saved} แถว` : `❌ ${json.error}`,
      );
    } catch {
      setSavedMsg("❌ เชื่อมต่อไม่ได้");
    } finally {
      setSaving(false);
    }
  }

  async function pull() {
    setBusy(true);
    setErr(null);
    setSplits({});
    setEnrichNote(null);
    setSavedMsg(null);
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
        const sp = splits[iv.ivId]; // ค่าห้อง/ขนม/ทิป (ถ้าดึง line items แล้ว)
        rows.push({
          id: `${date}-${sh}`,
          sales_date: date,
          shift: sh,
          rooms: null,
          room_revenue: sp?.room ?? null,
          fine: sp?.fine ?? null,
          tip: sp?.tip ?? null,
          goods_sales: sp?.goods ?? null,
          total_sales: iv.total,
          // จากไส้ใน IV (special_note): c1 เงินสด · c2 QR · c18/c19 ขาด/เกิน
          cash_to_remit: iv.cash, cash_pool: null, cash_deposited: null,
          cash_diff: null, advance: null,
          qr_morning: null, qr_after2330: null, qr_total: iv.qr,
          qr_banked: null, qr_diff: null,
          ota_agoda: null, ota_agoda_banked: null, ota_expedia: null,
          ota_expedia_banked: null, ota_booking: null, ota_booking_banked: null,
          staff_name: iv.status === "Paid" ? "จ่ายแล้ว" : "ค้าง",
          note: `IV #${iv.ivNo}`,
          over_short: (iv.over ?? 0) - (iv.short ?? 0),
        });
      };
      mk("morning", d.morning);
      mk("evening", d.evening);
    }
  } else {
    rows.push(...initialRows); // โหมดแสดงข้อมูลที่บันทึกไว้ (ยังไม่ดึงสด)
  }
  const days = groupByDay(rows);
  const showingSaved = !data && initialRows.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-zinc-800">ตาราง Excel จาก IV (TRCloud)</div>
          <div className="text-xs text-zinc-500">
            ยอดขายดึงจาก IV ที่หน้างานคีย์ · ช่องอื่น (QR/OTA/เงินสด) IV ไม่มี → ว่างไว้
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && (
            <button
              type="button"
              onClick={save}
              disabled={saving || busy}
              className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก…" : "💾 บันทึก"}
            </button>
          )}
          <button
            type="button"
            onClick={pull}
            disabled={busy}
            className="h-9 px-4 rounded-xl bg-[var(--ch-navy,#0b1850)] text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "กำลังดึง…" : data || showingSaved ? "ดึงใหม่" : "ดึง IV เดือนนี้"}
          </button>
        </div>
      </div>
      {savedMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm p-2.5">
          {savedMsg}
        </div>
      )}

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
          {days.some((d) => d.hasData) && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 border border-zinc-200 p-2.5">
              <span className="text-xs text-zinc-600">
                แยก <b>ค่าห้อง / ขนม / ทิป</b>:{" "}
                {Object.keys(splits).length}/{allIds.length} ใบ
              </span>
              {remainIds.length > 0 && (
                <button
                  type="button"
                  onClick={enrich}
                  disabled={enriching}
                  className="h-8 px-3 rounded-lg bg-[var(--ch-navy,#0b1850)] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {enriching
                    ? "กำลังดึง…"
                    : Object.keys(splits).length === 0
                      ? "ดึงรายละเอียด ห้อง/ขนม/ทิป"
                      : `ดึงเพิ่ม (เหลือ ${remainIds.length} ใบ)`}
                </button>
              )}
              {enrichNote && (
                <span className="text-xs text-amber-700">{enrichNote}</span>
              )}
            </div>
          )}
          {days.some((d) => d.hasData) ? (
            <HotelExcelGrid days={days} />
          ) : (
            <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 p-8 text-center">
              <div className="text-3xl mb-2">📭</div>
              <div className="font-semibold text-zinc-700">
                ไม่มี IV โรงแรมในเดือนนี้ใน TRCloud
              </div>
              <div className="text-sm text-zinc-500 mt-1">
                หน้างานยังไม่ได้คีย์ IV เข้า TRCloud สำหรับเดือนนี้
              </div>
              {data.availableMonths.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-zinc-500 mb-1.5">
                    TRCloud มี IV โรงแรมในเดือน — กดเพื่อไปดู:
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {data.availableMonths.map((ym) => (
                      <a
                        key={ym}
                        href={`/cashhub/hotel/iv?branchId=${branchId ?? ""}&month=${ym}`}
                        className="h-8 px-3 inline-flex items-center rounded-full bg-[var(--ch-navy,#0b1850)] text-white text-sm font-semibold"
                      >
                        {monthLabel(ym)} →
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* โหมดแสดงข้อมูลที่บันทึกไว้ (ยังไม่ดึงสด) */}
      {showingSaved && (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm p-2.5">
            📁 แสดงข้อมูลที่บันทึกไว้ ({savedCount} แถว) · กด “ดึงใหม่”
            เพื่ออัปเดตจาก TRCloud
          </div>
          <HotelExcelGrid days={days} />
        </>
      )}

      {!data && !busy && !showingSaved && (
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
