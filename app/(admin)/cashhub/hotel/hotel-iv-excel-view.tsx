"use client";

// หน้า B — แสดงตาราง Excel โดยเติมข้อมูลจาก "IV TRCloud" (ดึงสด ไม่เขียน DB)
// ตารางเดียวกับหน้า Sheet แต่ยอดขายมาจาก IV → ไว้เทียบว่าตรงกันไหม
import { useState } from "react";
import { formatBaht } from "@/lib/utils/format";
import {
  groupByDay,
  computeShiftBasis,
  TH_MONTHS,
  type HotelShiftRow,
} from "@/lib/cashhub/hotel";
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
          qr_banked: null, qr_diff: null, qr_scan_total: null, qr_overnight: null,
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
  // ── ฐานกะ: ย้ายยอด QR ช่วง 00:00–07:00 ไปกะคืนวันก่อน → "เข้าบัญชี" ตรงกับที่คีย์ ──
  // คิดจาก rows ทั้งหมด (รวมวันที่ 1 ของเดือนถัดไปที่หน้าโหลดมาให้) แล้วค่อยกรองเฉพาะเดือนนี้
  const ymPrefix = `${yy}-${String(mm).padStart(2, "0")}`;
  const shiftMap = computeShiftBasis(rows);
  const displayRows = rows
    .filter((r) => r.sales_date.startsWith(ymPrefix))
    .map((r) => {
      if (r.shift !== "morning") return r;
      const sb = shiftMap.get(r.sales_date);
      if (!sb || sb.shiftBanked == null) return r;
      return { ...r, qr_banked: sb.shiftBanked, qr_diff: sb.shiftDiff };
    });
  const days = groupByDay(displayRows);

  // สรุปยอดเทียบ (เฉพาะวันที่มีไฟล์ TTB แล้ว)
  let kpiRecorded = 0,
    kpiShift = 0,
    kpiSettlement = 0,
    kpiIncomplete = false,
    kpiHasTtb = false;
  for (const [date, sb] of shiftMap) {
    if (!date.startsWith(ymPrefix) || !sb.hasTtb) continue;
    kpiHasTtb = true;
    kpiRecorded += sb.recorded;
    kpiShift += sb.shiftBanked ?? 0;
    kpiSettlement += sb.settlement ?? 0;
    if (sb.incomplete) kpiIncomplete = true;
  }
  // เทียบรายวัน: ยอด QR ที่คีย์ (IV) ↔ เข้าบัญชี (ฐานกะ) → เห็นวันที่ไม่ตรงไว้เจาะตรวจ
  const dailyChecks = [...shiftMap.values()]
    .filter((sb) => sb.date.startsWith(ymPrefix) && sb.hasTtb)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((sb) => ({
      day: Number(sb.date.slice(8, 10)),
      recorded: sb.recorded,
      shiftBanked: sb.shiftBanked,
      diff: sb.shiftDiff, // เข้าบัญชี − คีย์
      incomplete: sb.incomplete,
    }));

  const kpi = kpiHasTtb ? (
    <>
      <QrReconcile
        recorded={kpiRecorded}
        shift={kpiShift}
        settlement={kpiSettlement}
        incomplete={kpiIncomplete}
      />
      <QrDailyCheck rows={dailyChecks} />
    </>
  ) : null;

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
            <>
              {kpi}
              <HotelExcelGrid days={days} />
            </>
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
          {kpi}
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

// สรุปการเทียบ QR: ยอดคีย์ (IV) ↔ เข้าบัญชีฐานกะ ↔ statement ธนาคาร
function QrReconcile({
  recorded,
  shift,
  settlement,
  incomplete,
}: {
  recorded: number;
  shift: number;
  settlement: number;
  incomplete: boolean;
}) {
  const diff = recorded - shift; // ควร ~0 = พนักงานคีย์ตรงกับเข้าบัญชี
  const matched = Math.abs(diff) < 1;
  const overnightCross = shift - settlement; // QR กะดึกที่ตกไปคนละเดือน (สุทธิ)
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="font-bold text-zinc-800">
        🧮 เทียบยอด QR — ฐานกะ (ตรงกับที่พนักงานคีย์)
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-zinc-50 p-2.5">
          <div className="text-[11px] text-zinc-500">ยอด QR ที่คีย์ (IV)</div>
          <div className="font-bold tabular-nums text-zinc-900">{formatBaht(recorded)}</div>
        </div>
        <div className="rounded-xl bg-zinc-50 p-2.5">
          <div className="text-[11px] text-zinc-500">เข้าบัญชี (ฐานกะ)</div>
          <div className="font-bold tabular-nums text-zinc-900">{formatBaht(shift)}</div>
        </div>
        <div
          className={`rounded-xl p-2.5 ${matched ? "bg-emerald-50" : "bg-amber-50"}`}
        >
          <div className="text-[11px] text-zinc-500">ต่าง</div>
          <div
            className={`font-bold tabular-nums ${matched ? "text-emerald-700" : "text-amber-700"}`}
          >
            {matched ? "ตรงกัน ✓" : formatBaht(diff)}
          </div>
        </div>
      </div>
      <div className="text-xs text-zinc-500 leading-relaxed border-t border-zinc-100 pt-2.5">
        เข้าบัญชีจริงตาม statement ธนาคาร (ตัดวันปฏิทิน 23:00) ={" "}
        <b className="text-zinc-700">{formatBaht(settlement)}</b> · ต่างจากฐานกะ{" "}
        <b className="text-zinc-700">{formatBaht(overnightCross)}</b> = QR กะดึกที่จ่ายเดือนนี้
        แต่ธนาคารเข้าบัญชีเดือนถัดไป (00:00–07:00 คร่อมเที่ยงคืน) — ไม่ใช่ยอดหาย
      </div>
      {incomplete && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2.5">
          ⚠️ วันสุดท้ายของเดือนยังคิดฐานกะไม่ครบ — ต้องอัปไฟล์ TTB <b>เดือนถัดไป</b> ด้วย
          (เพื่อเอายอด QR เช้ามืดวันที่ 1 ของเดือนถัดไป มารวมเข้ากะคืนวันสุดท้าย)
        </div>
      )}
    </div>
  );
}

// ตรวจรายวัน: ยอด QR ที่คีย์ (IV) ↔ เข้าบัญชี (ฐานกะ) — ดึงเฉพาะวันไม่ตรงมาโชว์
function QrDailyCheck({
  rows,
}: {
  rows: Array<{
    day: number;
    recorded: number;
    shiftBanked: number | null;
    diff: number | null;
    incomplete: boolean;
  }>;
}) {
  const [showAll, setShowAll] = useState(false);
  const mismatches = rows.filter((r) => !r.incomplete && Math.abs(r.diff ?? 0) >= 1);
  const pending = rows.filter((r) => r.incomplete);
  const matched = rows.filter((r) => !r.incomplete && Math.abs(r.diff ?? 0) < 1);
  const visible = showAll ? rows : [...mismatches, ...pending].sort((a, b) => a.day - b.day);
  const allGood = mismatches.length === 0 && pending.length === 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-zinc-800">🔍 ตรวจรายวัน — คีย์ (IV) ↔ เข้าบัญชี (ฐานกะ)</div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="h-7 px-2.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          {showAll ? "ดูเฉพาะวันต่าง" : "ดูทุกวัน"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 font-semibold">
          ตรง {matched.length} วัน
        </span>
        <span
          className={`rounded-full px-2.5 py-1 font-semibold ${mismatches.length ? "bg-red-50 text-red-700" : "bg-zinc-50 text-zinc-400"}`}
        >
          ต่าง {mismatches.length} วัน
        </span>
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 font-semibold">
            รอไฟล์เดือนถัดไป {pending.length} วัน
          </span>
        )}
      </div>

      {allGood && !showAll ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-2.5 text-center font-semibold">
          ✅ ทุกวันยอดคีย์ตรงกับเข้าบัญชี (ฐานกะ)
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-zinc-500 text-xs">
                <th className="px-2.5 py-1.5 text-left font-semibold">วันที่</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">คีย์ (IV)</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">เข้าบัญชี (กะ)</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">ต่าง</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const bad = !r.incomplete && Math.abs(r.diff ?? 0) >= 1;
                return (
                  <tr
                    key={r.day}
                    className={`border-t border-zinc-50 ${bad ? "bg-red-50/60" : r.incomplete ? "bg-amber-50/50" : ""}`}
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-zinc-700">{r.day}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-700">
                      {formatBaht(r.recorded)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-700">
                      {r.incomplete ? "—" : formatBaht(r.shiftBanked ?? 0)}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-right tabular-nums font-semibold ${bad ? "text-red-700" : r.incomplete ? "text-amber-700" : "text-emerald-700"}`}
                    >
                      {r.incomplete
                        ? "รอไฟล์เดือนถัดไป"
                        : bad
                          ? formatBaht(r.diff ?? 0)
                          : "ตรง ✓"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-zinc-400">
        “ต่าง” = เข้าบัญชี(ฐานกะ) − คีย์(IV) · วันที่ต่าง ≠ 0 = ควรเจาะตรวจ (เช่น พนักงานคีย์ผิด ·
        QR สแกนไม่ผ่านแต่ถูกนับ · ลูกค้าจ่ายช่องอื่น)
      </p>
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
