"use client";

import { useMemo, useState } from "react";
import { formatBaht } from "@/lib/utils/format";
import type {
  HotelDay,
  HotelMonthSummary,
  HotelShiftRow,
} from "@/lib/cashhub/hotel";
import { HotelExcelGrid } from "./hotel-excel-grid";

const baht = (v: number) => formatBaht(v);

function Kpi({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger" | "warning" | "ok";
}) {
  const ring =
    tone === "danger"
      ? "border-red-200 bg-red-50/60"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/60"
        : tone === "ok"
          ? "border-emerald-200 bg-emerald-50/50"
          : "border-zinc-200 bg-white";
  const valColor =
    tone === "danger"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-zinc-900";
  const subColor =
    tone === "danger"
      ? "text-red-600"
      : tone === "warning"
        ? "text-amber-600"
        : "text-zinc-500";
  return (
    <div className={`rounded-2xl border ${ring} p-3.5`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums ${valColor}`}>
        {value}
      </div>
      {sub && <div className={`mt-0.5 text-xs ${subColor}`}>{sub}</div>}
    </div>
  );
}

function ShiftDetail({ row, label }: { row: HotelShiftRow | null; label: string }) {
  if (!row) return null;
  const qrShift = (row.qr_morning ?? 0) + (row.qr_after2330 ?? 0);
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-xs">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-bold text-zinc-700">{label}</span>
        {row.staff_name && (
          <span className="text-zinc-500">เวร: {row.staff_name}</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 tabular-nums">
        <Field k="ห้อง" v={row.rooms ?? 0} raw />
        <Field k="ค่าห้อง" v={row.room_revenue ?? 0} />
        <Field k="ทิป" v={row.tip ?? 0} />
        <Field k="ขนม/ของ" v={row.goods_sales ?? 0} />
        <Field k="ค่าปรับ" v={row.fine ?? 0} />
        <Field k="ยอดขายรวม" v={row.total_sales ?? 0} bold />
        <Field k="QR กะนี้" v={qrShift} />
        <Field k="ส่งเงินสด" v={row.cash_to_remit ?? 0} />
      </div>
      {row.note && <div className="mt-1.5 text-amber-700">หมายเหตุ: {row.note}</div>}
    </div>
  );
}

function Field({
  k,
  v,
  bold,
  raw,
}: {
  k: string;
  v: number;
  bold?: boolean;
  raw?: boolean;
}) {
  return (
    <div className="flex justify-between gap-1">
      <span className="text-zinc-400">{k}</span>
      <span className={bold ? "font-bold text-zinc-800" : "text-zinc-700"}>
        {raw ? v.toLocaleString() : baht(v)}
      </span>
    </div>
  );
}

export function HotelMonthView({
  days,
  summary,
  monthCheck,
  hasBranch,
}: {
  days: HotelDay[];
  summary: HotelMonthSummary;
  monthCheck: {
    rooms_sheet: number | null;
    revenue_sheet: number | null;
    rooms_pos: number | null;
    revenue_pos: number | null;
  } | null;
  hasBranch: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [view, setView] = useState<"grid" | "summary">("grid");
  const dataDays = useMemo(() => days.filter((d) => d.hasData), [days]);
  const flaggedCount = useMemo(
    () => dataDays.filter((d) => d.flagged).length,
    [dataDays],
  );
  const shownDays = onlyFlagged
    ? dataDays.filter((d) => d.flagged)
    : dataDays;

  if (!hasBranch) {
    return (
      <div className="rounded-2xl border border-zinc-200 p-8 text-center text-zinc-500">
        ยังไม่มีสาขาโรงแรมในระบบ
      </div>
    );
  }
  if (dataDays.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center">
        <div className="text-3xl mb-2">🏨</div>
        <div className="font-semibold text-zinc-700">ยังไม่มีข้อมูลเดือนนี้</div>
        <div className="text-sm text-zinc-500 mt-1">
          กด “นำเข้าจากชีต” เพื่อเพิ่มยอดขายรายวันของเดือนนี้
        </div>
      </div>
    );
  }

  const posDiffRooms =
    monthCheck?.rooms_sheet != null && monthCheck?.rooms_pos != null
      ? monthCheck.rooms_sheet - monthCheck.rooms_pos
      : null;
  const posDiffRev =
    monthCheck?.revenue_sheet != null && monthCheck?.revenue_pos != null
      ? monthCheck.revenue_sheet - monthCheck.revenue_pos
      : null;

  const qrTone: "danger" | "warning" | "ok" =
    summary.qrFlagCount > 0 ? "danger" : summary.qrUncheckedCount > 0 ? "warning" : "ok";
  const qrSub =
    summary.qrFlagCount > 0
      ? `ส่วนต่างรวม ${baht(summary.qrDiffAbs)} · ${summary.qrFlagCount} วัน`
      : summary.qrUncheckedCount > 0
        ? `รอตรวจ ${summary.qrUncheckedCount} วัน`
        : `ตรงยอดสแกน ${baht(summary.qrTotal)}`;

  return (
    <div className="space-y-5">
      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="ยอดขายรวมเดือน"
          value={baht(summary.totalSales)}
          sub={`${summary.daysWithData} วัน · ห้อง+ทิป+ขนม`}
        />
        <Kpi
          label="เงินสดส่งเข้า (รอบส่ง)"
          value={baht(summary.cashDeposited)}
          sub="กะดึก+กะเช้า เก็บ ~10 โมง"
        />
        <Kpi
          label="QR เข้าบัญชี TTB"
          value={baht(summary.qrBanked)}
          sub={qrSub}
          tone={qrTone}
        />
        <Kpi
          label="OTA (จ่าย / เข้าจริง)"
          value={baht(summary.otaPaid)}
          sub={`เข้าจริง ${baht(summary.otaBanked)} · หลังหักค่าคอม`}
        />
      </div>

      {/* ── Verification banner (3 สถานะ) ── */}
      {summary.qrFlagCount > 0 ? (
        <Banner tone="danger" icon="🔴" title={`QR ไม่เข้าบัญชี ${summary.qrFlagCount} วัน`}>
          รวมส่วนต่าง QR (ไม่หักกลบ) {baht(summary.qrDiffAbs)} — เช็ควันที่ขึ้นแดงด้านล่าง
          (ยอดที่ลูกค้าสแกน ยังไม่เข้า/ไม่ตรงยอดเข้าบัญชีจริง)
        </Banner>
      ) : summary.qrUncheckedCount > 0 ? (
        <Banner
          tone="warning"
          icon="🟡"
          title={`รอตรวจยอดเข้าบัญชี ${summary.qrUncheckedCount} วัน`}
        >
          มียอด QR ที่ลูกค้าสแกน แต่ยังไม่ได้กรอก “ยอดเข้าบัญชี” — ยังสรุปไม่ได้ว่าเข้าครบ
        </Banner>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 flex items-center gap-2 text-emerald-800 text-sm font-semibold">
          ✅ QR เข้าบัญชีครบทุกวัน — ยอดสแกนตรงยอดเข้าบัญชี
        </div>
      )}
      {summary.integrityCount > 0 && (
        <Banner
          tone="danger"
          icon="⚠️"
          title={`ยอดขายรวมไม่ตรงองค์ประกอบ ${summary.integrityCount} วัน`}
        >
          ยอดขายรวม ≠ ค่าห้อง+ค่าปรับ+ทิป+ขนม — อาจมีสูตร/ตัวเลขในชีตพิมพ์ผิด
        </Banner>
      )}

      {/* ── POS cross-check ── */}
      {monthCheck && (posDiffRooms !== null || posDiffRev !== null) && (
        <div
          className={`rounded-2xl border p-4 ${
            posDiffRev && Math.abs(posDiffRev) >= 1
              ? "border-amber-200 bg-amber-50/40"
              : "border-zinc-200 bg-white"
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
            ตรวจยอด: Sheet ↔ POS หน้าโรงแรม
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <PosCol label="ตาม Sheet" rev={monthCheck.revenue_sheet} rooms={monthCheck.rooms_sheet} />
            <PosCol label="ตาม POS" rev={monthCheck.revenue_pos} rooms={monthCheck.rooms_pos} />
            <div>
              <div className="text-zinc-400 text-xs">ส่วนต่าง</div>
              <div
                className={`font-extrabold tabular-nums ${
                  posDiffRev && Math.abs(posDiffRev) >= 1 ? "text-amber-700" : "text-zinc-700"
                }`}
              >
                {baht(posDiffRev ?? 0)}
              </div>
              <div className="text-xs text-zinc-500 tabular-nums">
                {posDiffRooms?.toLocaleString()} ห้อง
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── tabs (ตารางเต็ม / สรุปรายวัน) + filter ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-zinc-200 p-0.5 bg-zinc-50">
          <Tab active={view === "grid"} onClick={() => setView("grid")}>
            📊 ตารางเต็ม (Excel)
          </Tab>
          <Tab active={view === "summary"} onClick={() => setView("summary")}>
            📋 สรุปรายวัน
          </Tab>
        </div>
        <div className="flex-1" />
        {flaggedCount > 0 && (
          <div className="flex gap-2 text-sm">
            <Chip active={!onlyFlagged} onClick={() => setOnlyFlagged(false)}>
              ทั้งเดือน ({dataDays.length})
            </Chip>
            <Chip active={onlyFlagged} onClick={() => setOnlyFlagged(true)} danger>
              เฉพาะวันผิด 🔴 ({flaggedCount})
            </Chip>
          </div>
        )}
      </div>

      {view === "grid" ? (
        <HotelExcelGrid days={shownDays} />
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50">
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200">
                  <th className="text-left font-semibold px-3 py-2.5 sticky left-0 bg-zinc-50">
                    วันที่
                  </th>
                  <th className="text-right font-semibold px-2 py-2.5">ห้อง</th>
                  <th className="text-right font-semibold px-2 py-2.5">ยอดขาย</th>
                  <th className="text-right font-semibold px-2 py-2.5">เงินสดส่ง</th>
                  <th className="text-right font-semibold px-2 py-2.5">QR บันทึก</th>
                  <th className="text-right font-semibold px-2 py-2.5">เข้าบัญชี</th>
                  <th className="text-right font-semibold px-2 py-2.5">ส่วนต่าง</th>
                  <th className="text-right font-semibold px-2 py-2.5">OTA</th>
                  <th className="text-right font-semibold px-2 py-2.5">เกิน/ขาด</th>
                </tr>
              </thead>
              <tbody>
                {shownDays.map((d) => (
                  <DayRows
                    key={d.date}
                    d={d}
                    isOpen={open === d.date}
                    onToggle={() => setOpen(open === d.date ? null : d.date)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400">
        หน่วยเงินสด = รอบส่งเงิน (กะดึก 18:00–07:00 + กะเช้า 07:00–18:00 เก็บ ~10 โมง) ·
        ฝั่ง “เข้าบัญชี” คือสะพานไป reconcile กับ statement ธนาคาร · ส่วนต่างคำนวณจากยอดเข้าจริง
      </p>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-lg text-sm font-semibold transition ${
        active ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: "danger" | "warning";
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  const c =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  const sub = tone === "danger" ? "text-red-700" : "text-amber-700";
  return (
    <div className={`rounded-2xl border ${c} p-4 flex items-start gap-3`}>
      <span className="text-xl">{icon}</span>
      <div>
        <div className="font-bold">{title}</div>
        <div className={`text-sm ${sub}`}>{children}</div>
      </div>
    </div>
  );
}

function PosCol({
  label,
  rev,
  rooms,
}: {
  label: string;
  rev: number | null;
  rooms: number | null;
}) {
  return (
    <div>
      <div className="text-zinc-400 text-xs">{label}</div>
      <div className="font-bold tabular-nums">{baht(rev ?? 0)}</div>
      <div className="text-xs text-zinc-500 tabular-nums">
        {rooms?.toLocaleString()} ห้อง
      </div>
    </div>
  );
}

function Chip({
  active,
  danger,
  onClick,
  children,
}: {
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-full font-semibold border transition ${
        active
          ? danger
            ? "bg-red-600 text-white border-red-600"
            : "bg-zinc-900 text-white border-zinc-900"
          : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

const dash = <span className="text-zinc-200">—</span>;

function DayRows({
  d,
  isOpen,
  onToggle,
}: {
  d: HotelDay;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-zinc-50 hover:bg-zinc-50/80 ${
          d.flagged ? "border-l-2 border-l-red-400" : ""
        }`}
      >
        <td className="px-3 py-2.5 font-semibold text-zinc-800 sticky left-0 bg-white">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-zinc-300">{isOpen ? "▾" : "▸"}</span>
            {d.day}
            {!d.salesIntegrity && <span title="ยอดรวมไม่ตรงองค์ประกอบ">⚠️</span>}
          </span>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-zinc-500">{d.rooms}</td>
        <td className="px-2 py-2.5 text-right tabular-nums font-semibold">
          {baht(d.totalSales)}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">{baht(d.cashDeposited)}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">{baht(d.qrTotal)}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">
          {d.qrChecked ? (
            baht(d.qrBanked)
          ) : d.qrTotal > 0 ? (
            <span className="text-amber-600 text-xs font-semibold">รอตรวจ</span>
          ) : (
            dash
          )}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">
          {d.qrFlag ? (
            <span className="inline-block rounded-md bg-red-100 px-1.5 py-0.5 font-bold text-red-800">
              {baht(d.qrDiff)}
            </span>
          ) : (
            dash
          )}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">
          {d.otaPaid > 0 ? baht(d.otaPaid) : dash}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">
          {d.overShort !== 0 ? (
            <span
              className={
                d.overShort < 0
                  ? "inline-block rounded-md bg-red-100 px-1.5 py-0.5 font-bold text-red-800"
                  : "text-emerald-700 font-semibold"
              }
            >
              {baht(d.overShort)}
            </span>
          ) : (
            dash
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-zinc-50/40">
          <td colSpan={9} className="px-3 py-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <ShiftDetail row={d.morning} label="กะเช้า · 07:00–18:00" />
              <ShiftDetail row={d.evening} label="กะดึก · 18:00–07:00" />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
