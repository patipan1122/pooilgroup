"use client";

// Reconcile tab — bank statement match preview.
// v1 reads from existing daily_reports + cash_shortages (no new tables).
// Buttons "Import Statement / Match อัตโนมัติ" navigate to existing import
// route or show toast — we never mutate diffs from this surface
// (see [[cashhub-shortage-flow-d020]]).

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  Upload,
  Link as LinkIcon,
  Check,
  AlertCircle,
  Sparkles,
  X as XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import type { ReconcileRow, ReconcileStatus } from "@/lib/cashhub/bank-reconcile";

interface Props {
  rows: ReconcileRow[];
  summary: {
    matched: number;
    diff: number;
    noBank: number;
    missingFill: number;
    bankIncomeToday: number;
  };
}

const STATUS_MAP: Record<
  ReconcileStatus,
  { c: string; bg: string; label: string; Icon: typeof Check }
> = {
  matched:        { c: "var(--ch-ok)",     bg: "var(--ch-ok-soft)",     label: "ตรง",         Icon: Check },
  diff:           { c: "var(--ch-danger)", bg: "var(--ch-danger-soft)", label: "ต่าง",        Icon: AlertCircle },
  "no-bank":      { c: "#a16207",          bg: "var(--ch-pending-soft)", label: "ยังไม่ลง",     Icon: Sparkles },
  "missing-fill": { c: "var(--ch-text-2)", bg: "var(--ch-bg-3)",         label: "ไม่มียอดกรอก", Icon: XIcon },
};

function formatBaht(n: number | null) {
  if (n == null) return "—";
  if (n === 0) return "฿0";
  return "฿" + Math.round(n).toLocaleString("en-US");
}

function formatDateThai(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  const MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${d} ${MONTHS[m - 1]}`;
}

export function ReconcileTab({ rows, summary }: Props) {
  const [abnormalOnly, setAbnormalOnly] = useState(true);
  const visibleRows = useMemo(
    () => (abnormalOnly ? rows.filter((r) => r.status !== "matched") : rows),
    [rows, abnormalOnly],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 mt-5">
      <div className="ch-card-v2 bg-white overflow-hidden">
        {/* Filters — design heatmap.jsx:406-419 */}
        <div className="px-4 py-3 border-b border-[var(--ch-border)] flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[var(--ch-text-3)]">
            กรอง:
          </span>
          <button
            type="button"
            onClick={() => setAbnormalOnly((v) => !v)}
            className={`ch-chip-v2 ${abnormalOnly ? "active" : ""}`}
          >
            ผิดปกติเท่านั้น
          </button>
          <span className="ch-chip-v2 cursor-default opacity-70">
            ช่วง 3 วันล่าสุด
          </span>
          <button
            type="button"
            onClick={() => toast.info("ตัวกรองธนาคารจะเปิดใช้พร้อม Statement import")}
            className="ch-chip-v2 cursor-default opacity-60"
            disabled
          >
            ทุกธนาคาร
          </button>
          <button
            type="button"
            onClick={() => toast.info("ตัวกรองประเภทธุรกิจกำลังจะมา")}
            className="ch-chip-v2 cursor-default opacity-60"
            disabled
          >
            ทุกธุรกิจ
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => toast.info("ฟีเจอร์นำเข้า Statement กำลังจะมา · เร็วๆ นี้")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--ch-border-strong)] bg-white text-xs font-semibold text-[var(--ch-text)] hover:bg-zinc-50"
          >
            <Upload className="size-3.5" /> นำเข้า Statement
          </button>
          <button
            type="button"
            onClick={() =>
              toast.info("Auto-match รอเปิดใช้ในเฟสถัดไป · กำลังเก็บข้อมูลแบงก์ก่อน")
            }
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--ch-brand)] text-white text-xs font-semibold hover:bg-[var(--ch-brand-700)]"
          >
            <LinkIcon className="size-3.5" /> Match อัตโนมัติ
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="ch-table-v2 w-full text-sm">
            <thead className="sticky top-14 sm:top-16 z-20">
              <tr>
                <th className="text-left px-3 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)]">
                  วัน · สาขา
                </th>
                <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)]">
                  ยอดในระบบ
                </th>
                <th className="text-center px-2 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)] w-8" />
                <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)]">
                  เงินเข้าจริง
                </th>
                <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)]">
                  ต่าง
                </th>
                <th className="text-center px-3 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)]">
                  สถานะ
                </th>
                <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase text-[var(--ch-text-3)]">
                  ทำต่อ
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center text-[var(--ch-text-3)] py-8 text-sm"
                  >
                    {abnormalOnly
                      ? "ไม่มีรายการผิดปกติในช่วงนี้ — ตรงพอดีทุกรายงาน"
                      : "ไม่มีรายงานในช่วงนี้"}
                  </td>
                </tr>
              ) : (
                visibleRows.map((r, i) => {
                  const st = STATUS_MAP[r.status];
                  const { Icon } = st;
                  return (
                    <tr
                      key={`${r.reportId ?? "missing"}-${r.date}-${i}`}
                      className="border-t border-[var(--ch-border)] hover:bg-[var(--ch-bg-2)]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="text-sm font-semibold">{r.name}</div>
                        <div className="text-[10.5px] text-[var(--ch-text-3)] mt-0.5">
                          {formatDateThai(r.date)} · {r.code}
                          {r.staffName ? ` · กรอกโดย ${r.staffName}` : ""}
                        </div>
                      </td>
                      <td
                        className={`ch-tnum text-right px-3 py-2.5 font-semibold ${
                          r.filled === 0
                            ? "text-[var(--ch-text-3)]"
                            : "text-[var(--ch-text)]"
                        }`}
                      >
                        {r.filled === 0 ? "—" : formatBaht(r.filled)}
                      </td>
                      <td className="px-2 py-2.5 text-center text-[var(--ch-text-3)]">
                        <LinkIcon className="size-3.5 inline" />
                      </td>
                      <td
                        className={`ch-tnum text-right px-3 py-2.5 font-semibold ${
                          r.bank == null
                            ? "text-[var(--ch-text-3)]"
                            : "text-[var(--ch-text)]"
                        }`}
                      >
                        {formatBaht(r.bank)}
                      </td>
                      <td
                        className="ch-tnum text-right px-3 py-2.5 font-bold"
                        style={{
                          color:
                            r.diff == null || r.diff === 0
                              ? "var(--ch-text-3)"
                              : r.diff > 0
                                ? "var(--ch-ok)"
                                : "var(--ch-danger)",
                        }}
                      >
                        {r.diff == null || r.diff === 0
                          ? "—"
                          : (r.diff > 0 ? "+" : "") +
                            formatBaht(Math.abs(r.diff))}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: st.bg, color: st.c }}
                        >
                          <Icon className="size-3" strokeWidth={2} />
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <RowActions row={r} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right rail: how it works + today summary */}
      <div className="flex flex-col gap-3">
        <div className="ch-card-v2 bg-white p-4">
          <SectionPill num="?" label="How it works" />
          <h3 className="text-base font-bold text-[var(--ch-navy)] mt-2 mb-2.5">
            Bank Reconcile <span className="text-[var(--ch-brand)]">4 ขั้น</span>
          </h3>
          <ol className="flex flex-col gap-3">
            {[
              { n: 1, t: "เชื่อมแบงก์ / นำเข้า .CSV", d: "SCB · KBank · Krungsri รองรับ statement รายวัน" },
              { n: 2, t: "Match อัตโนมัติ", d: "จับคู่ด้วยจำนวนเงิน + วัน + เลขอ้างอิงสาขา" },
              { n: 3, t: "ตรวจรายการที่ต่าง", d: "ทักผู้กรอก / ดูสาเหตุ / ไม่ลบเงินขาด" },
              { n: 4, t: "ล็อกงวด", d: "รายการที่ matched ปิดงวดอัตโนมัติเข้าบัญชี" },
            ].map((s) => (
              <li key={s.n} className="flex gap-2.5">
                <span className="size-5 shrink-0 rounded-full bg-[var(--ch-brand)] text-white text-[11px] font-bold grid place-items-center">
                  {s.n}
                </span>
                <div>
                  <div className="text-[12.5px] font-semibold leading-tight">
                    {s.t}
                  </div>
                  <div className="text-[11px] text-[var(--ch-text-3)] mt-0.5">
                    {s.d}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="ch-card-v2 p-4 text-white"
          style={{ background: "var(--ch-navy)" }}
        >
          <div className="text-[10.5px] uppercase tracking-wider opacity-70 font-semibold">
            Tip
          </div>
          <h3 className="text-sm font-bold mt-1.5 mb-2">
            เริ่มกับ <span style={{ color: "#7eb8ff" }}>EV Station</span> ก่อน
          </h3>
          <p className="text-[11.5px] opacity-85 leading-relaxed">
            EV รับเงินผ่านแอป → ลงแบงก์เป็นรายการชัด match ง่ายสุด
            ค่อยขยายไป Café แล้วจึงปั๊มน้ำมัน
          </p>
        </div>

        <div className="ch-card-v2 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ch-text-3)]">
            สรุปวันนี้
          </div>
          <div className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span>ตรงพอดี</span>
              <span className="ch-tnum font-semibold text-[var(--ch-ok)]">
                {summary.matched}
              </span>
            </div>
            <div className="flex justify-between">
              <span>ยอดต่าง</span>
              <span className="ch-tnum font-semibold text-[var(--ch-danger)]">
                {summary.diff}
              </span>
            </div>
            <div className="flex justify-between">
              <span>เงินยังไม่ลง</span>
              <span className="ch-tnum font-semibold text-[#a16207]">
                {summary.noBank}
              </span>
            </div>
            <div className="flex justify-between">
              <span>ไม่มียอดกรอก</span>
              <span className="ch-tnum font-semibold text-[var(--ch-text-3)]">
                {summary.missingFill}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Per-row action buttons — status-dependent CTAs matching design heatmap.jsx:468-481.
// "ปรับยอด" and "หาเงินเข้า" are deferred behind toast stubs since they require
// either a manual override flow (which would violate [[cashhub-shortage-flow-d020]]:
// "ห้ามแก้ reconcile formula") or a bank-statement matching backend we haven't shipped.
function RowActions({ row }: { row: ReconcileRow }) {
  if (row.status === "diff" && row.reportId) {
    return (
      <div className="flex gap-1 justify-end">
        <button
          type="button"
          onClick={() =>
            toast.info(
              "ปรับยอดต้องผ่าน Manager · เปิดรายงานเพื่อดูรายละเอียดก่อน",
            )
          }
          className="inline-flex items-center h-7 px-2.5 rounded-md border border-[var(--ch-border-strong)] bg-white text-[11px] font-semibold hover:bg-zinc-50"
        >
          ปรับยอด
        </button>
        <Link
          href={`/cashhub/reports/${row.reportId}`}
          className="inline-flex items-center h-7 px-2.5 rounded-md bg-[var(--ch-brand)] text-white text-[11px] font-semibold hover:bg-[var(--ch-brand-700)]"
        >
          ทักผู้กรอก
        </Link>
      </div>
    );
  }
  if (row.status === "no-bank" && row.reportId) {
    return (
      <button
        type="button"
        onClick={() =>
          toast.info(
            "หาเงินเข้า … ต้องเชื่อม Bank statement · กำลังจะมาเฟสถัดไป",
          )
        }
        className="inline-flex items-center h-7 px-2.5 rounded-md border border-[var(--ch-border-strong)] bg-white text-[11px] font-semibold hover:bg-zinc-50"
      >
        หาเงินเข้า…
      </button>
    );
  }
  if (row.status === "missing-fill") {
    return (
      <Link
        href="/liff/report"
        className="inline-flex items-center h-7 px-2.5 rounded-md border border-[var(--ch-border-strong)] bg-white text-[11px] font-semibold hover:bg-zinc-50"
      >
        เปิดยอด
      </Link>
    );
  }
  // matched (or fallback)
  if (row.reportId) {
    return (
      <Link
        href={`/cashhub/reports/${row.reportId}`}
        className="inline-flex items-center h-7 px-2.5 rounded-md border border-[var(--ch-border-strong)] bg-white text-[11px] font-semibold hover:bg-zinc-50"
      >
        ดู
      </Link>
    );
  }
  return <span className="text-[var(--ch-text-3)] text-xs">—</span>;
}
