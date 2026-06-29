// Reconcile v2 server-rendered views — Hero · Freshness · Ledger · Timeline ·
// Periods. All pure server components (no client JS). SVG charts are hand-rolled
// (no chart lib) — mockup proves plain SVG renders the timeline + sparkline.
//
// Thai labels are verbatim from the mockup. Currency uses baht(n, true) for
// signed values per the spec.

import Link from "next/link";
import {
  Upload,
  Calendar,
  Landmark,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Minus,
  Paperclip,
  Eye,
  Info,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { baht } from "@/lib/chairops/utils/format";
import { SlipBadge, DepositAmount } from "@/components/chairops/redesign/slip-viewer";
import {
  ledgerCumClass,
  ledgerDiffClass,
  type LedgerDay,
  type LedgerTotals,
  type ReconcileFreshness,
  type ReconcileOverview,
  type TimelinePoint,
  type PeriodWindow,
  type ReconcileDayDetail,
  type ReconcilePerChair,
  type PerChairRow,
  type ReconcilePerChairDetail,
  type PerChairDay,
  type PerChairDetailCell,
} from "@/lib/chairops/queries/reconcile-v2";

const fmtN = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : (n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("en-US");
const fmtSigned = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : (n > 0 ? "+" : n < 0 ? "−" : "") +
      Math.abs(Math.round(n)).toLocaleString("en-US");

const TH_DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
function dayOfWeekTh(dStr: string): string {
  return TH_DOW[new Date(dStr).getUTCDay()];
}

// ─────────────────────────────────────────────────────────────
// Freshness bar — 4-cell grid
// ─────────────────────────────────────────────────────────────
export function FreshnessBar({
  freshness,
  context,
}: {
  freshness: ReconcileFreshness;
  context: "org" | "branch";
}) {
  return (
    <div className="rc-fresh">
      <div className="rc-fresh-item">
        <div className="rc-fresh-icon">
          <Upload size={14} aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="rc-fresh-label">อัพ POS ล่าสุด</div>
          <div className="rc-fresh-value">
            {freshness.lastPosUploadAt ?? "ยังไม่เคยอัพ"}
          </div>
        </div>
      </div>
      <div className="rc-fresh-item">
        <div className="rc-fresh-icon">
          <Calendar size={14} aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="rc-fresh-label">POS ครบถึงวัน</div>
          <div className="rc-fresh-value">
            {freshness.posCoverThrough ?? "—"}{" "}
            {freshness.posCoverDaysAgo != null && (
              <span className="text-3">· {freshness.posCoverDaysAgo} วันก่อน</span>
            )}
          </div>
        </div>
      </div>
      <div className="rc-fresh-item">
        <div className="rc-fresh-icon">
          <Landmark size={14} aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="rc-fresh-label">
            {context === "org" ? "แม่บ้านเก็บล่าสุด (รวม)" : "เก็บล่าสุดสาขานี้"}
          </div>
          <div className="rc-fresh-value">
            {freshness.lastCollectionLabel ?? "—"}
          </div>
        </div>
      </div>
      {freshness.staleBranchCount > 0 && (
        <div className="rc-fresh-item rc-fresh-warn">
          <div className="rc-fresh-icon">
            <AlertTriangle size={14} aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="rc-fresh-label">สาขาที่ค้างเก็บ ≥5 วัน</div>
            <div className="rc-fresh-value">
              {freshness.staleBranchCount} สาขา{" "}
              {freshness.staleBranchNames.length > 0 && (
                <span className="text-3">
                  · {freshness.staleBranchNames.join(" · ")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Hero — cumulative drift big number + sparkline
// ─────────────────────────────────────────────────────────────
export function DriftHero({
  overview,
  label,
}: {
  overview: ReconcileOverview;
  label: string;
}) {
  const { cumulativeDrift, monthlyTrend, intent, spark } = overview;
  const trendDir = monthlyTrend < 0 ? "down" : monthlyTrend > 0 ? "up" : "flat";
  const TrendIcon =
    monthlyTrend < 0 ? ArrowDown : monthlyTrend > 0 ? ArrowUp : Minus;
  const note =
    intent === "crit"
      ? "⚠ โตเรื่อย ๆ ไม่หยุด — ต้องตรวจ"
      : intent === "ok"
        ? "นิ่ง ปกติ"
        : "ผันผวน";

  return (
    <div className="rc-hero" data-intent={intent}>
      <div className="rc-hero-main">
        <div className="rc-hero-label">{label}</div>
        <div className="rc-hero-value mono">
          {fmtSigned(cumulativeDrift)} <span>฿</span>
        </div>
        <div className="rc-hero-meta">
          <span className={"co-trend " + trendDir}>
            <TrendIcon size={11} aria-hidden="true" />
            {fmtSigned(monthlyTrend)} ฿/เดือน
          </span>
          <span className="text-3">{note}</span>
        </div>
      </div>
      <div className="rc-hero-spark">
        <SparkArea data={spark} />
      </div>
    </div>
  );
}

function SparkArea({ data }: { data: number[] }) {
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0);
  const W = 260;
  const H = 56;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * (H - 4) - 2;
  const x = (i: number) => (i / (data.length - 1 || 1)) * W;
  const line = data
    .map((v, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(v))
    .join(" ");
  const zero = y(0);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label="แนวโน้ม drift สะสม 30 วัน"
    >
      <line
        x1="0"
        x2={W}
        y1={zero}
        y2={zero}
        stroke="var(--border-strong)"
        strokeDasharray="2 2"
      />
      <path d={`${line} L ${W},${H} L 0,${H} Z`} fill="currentColor" opacity="0.12" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Tabs (URL-driven · server <a> links)
// ─────────────────────────────────────────────────────────────
export function ReconcileTabs({
  baseHref,
  active,
}: {
  baseHref: string;
  active: "ledger" | "timeline" | "periods" | "perchair";
}) {
  const tab = (
    key: "ledger" | "timeline" | "periods" | "perchair",
    label: string,
  ) => {
    const href =
      key === "ledger" ? baseHref : `${baseHref}?view=${key}`;
    return (
      <Link
        href={href}
        className="rc-tab"
        data-active={active === key ? "" : undefined}
        scroll={false}
      >
        {label}
      </Link>
    );
  };
  return (
    <div className="rc-tabs-row">
      <div className="rc-tabs">
        {tab("ledger", "Ledger")}
        {tab("timeline", "Timeline")}
        {tab("periods", "รอบเก็บ (Periods)")}
        {tab("perchair", "รายตู้")}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ledger tab — bank-statement table
// ─────────────────────────────────────────────────────────────
// F1 (audit MISS-04 · 2026-06-02): tiny source-badge column shows where each
// day's collection rows came from — MAID_MANUAL / CSV_IMPORT / OFFICE_PROXY.
// Helps CEO eyeball which days were filled in by CSV after the fact.
function sourceBadge(src: LedgerDay["sources"][number]) {
  if (src === "MAID_MANUAL")
    return { label: "มือ", title: "แม่บ้านบันทึกใน LIFF", tone: "neutral" as const };
  if (src === "CSV_IMPORT")
    return { label: "Import", title: "นำเข้าจาก CSV", tone: "warning" as const };
  return { label: "Office", title: "สำนักงานบันทึกแทน", tone: "info" as const };
}

const SOURCE_TONE_CLASS: Record<"neutral" | "warning" | "info", string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  warning: "bg-amber-50 text-amber-800",
  info: "bg-sky-50 text-sky-700",
};

export function LedgerTab({
  ledger,
  totals,
  isOrg,
  csvOnlyMissingSlip,
  makeDayHref,
  activeDay,
}: {
  ledger: LedgerDay[];
  /** Footer totals (null when no rows). */
  totals: LedgerTotals | null;
  isOrg: boolean;
  /**
   * When true, only render days where at least one CSV_IMPORT row has no slip.
   * Drives the "ยังไม่มีสลิป" filter chip wired in reconcile-shell.
   */
  csvOnlyMissingSlip?: boolean;
  /** CEO 2026-06-25: build a drill-down URL for a given day (?day=...). */
  makeDayHref?: (day: string) => string;
  /** Currently drilled-in day (highlights its row). */
  activeDay?: string | null;
}) {
  const rows = csvOnlyMissingSlip
    ? ledger.filter((d) => d.hasCsvWithoutSlip)
    : ledger;
  return (
    <div className="rc-ledger">
      {/* CEO 2026-06-29: legend so the click targets are discoverable — the
          report drill-down was already there but invisible ("กดดูไม่ได้"). */}
      {makeDayHref && (
        <div
          className="text-3"
          style={{
            fontSize: 11,
            padding: "6px 2px 8px",
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span>
            <span style={{ color: "var(--accent)" }}>🔍 กดที่วันที่</span> ดูรายการย่อย
            (เก็บ/ฝาก แยก CSV·แม่บ้าน)
          </span>
          {rows.some((d) => d.writeOffNet) && (
            <span>✂️ กดดูรายละเอียดการตัดเงิน</span>
          )}
        </div>
      )}
      <table className="tbl rc-ledger-tbl">
        <thead>
          <tr>
            <th>วันที่</th>
            <th className="num">ออนไลน์</th>
            <th className="num">เงินสด</th>
            <th className="num">เหรียญ (บาท)</th>
            <th className="num rc-tcol">รวมเงินสด</th>
            <th className="num">รายได้รวม</th>
            <th className="num rc-tcol">ฝาก</th>
            <th className="num">เก็บ·ยังไม่ฝาก</th>
            <th>ที่มา</th>
            <th>สลิป</th>
            <th className="num">หาย</th>
            <th className="num rc-tcol">หายสะสม</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={12}
                style={{ textAlign: "center", padding: "48px 0" }}
                className="text-3"
              >
                {csvOnlyMissingSlip
                  ? "ไม่มีรอบเก็บ CSV ที่ยังไม่มีสลิปในช่วงนี้"
                  : "ยังไม่มีข้อมูล · อัพ POS แล้ว Recompute ก่อน"}
              </td>
            </tr>
          )}
          {rows.map((d) => (
            <tr
              key={d.date}
              className={
                (d.collected ? "rc-row-collected" : "") +
                (activeDay === d.date ? " rc-row-active" : "")
              }
              // CEO 2026-06-25: ระบายสีม่วงแถวที่มี "ตัดเงิน/ตั้งต้น" มีผล เพื่อให้
              // เห็นทันทีว่ายอดสะสมกระโดดเข้า 0 ตรงไหน · เมาส์ชี้ ✂️ ดูรายละเอียด.
              style={
                activeDay === d.date
                  ? { background: "var(--accent-soft)" }
                  : d.writeOffNet
                    ? { background: "rgba(139, 92, 246, 0.12)" }
                    : undefined
              }
            >
              <td>
                {makeDayHref ? (
                  <Link
                    href={makeDayHref(d.date)}
                    className="rc-date"
                    title="ดูรายการย่อยของวันนี้ (เก็บ/ฝาก รายก้อน)"
                    style={{ textDecoration: "none", cursor: "pointer" }}
                    scroll={false}
                  >
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: "var(--accent)" }}
                    >
                      {d.date.slice(5)}
                    </span>
                    <span className="text-3" style={{ fontSize: 10.5 }}>
                      {dayOfWeekTh(d.date)} · 🔍
                    </span>
                  </Link>
                ) : (
                  <div className="rc-date">
                    <span className="mono" style={{ fontSize: 12 }}>
                      {d.date.slice(5)}
                    </span>
                    <span className="text-3" style={{ fontSize: 10.5 }}>
                      {dayOfWeekTh(d.date)}
                    </span>
                  </div>
                )}
              </td>
              <td className="num mono">{fmtN(d.online)}</td>
              <td className="num mono">{fmtN(d.cash)}</td>
              <td className="num mono" title={`${fmtN(d.coin)} ครั้ง × 10 บาท`}>
                {fmtN(d.coinBaht)}
              </td>
              <td className="num mono rc-tcol">{fmtN(d.cashTotal)}</td>
              <td className="num mono" style={{ fontWeight: 500 }}>
                {fmtN(d.totalRev)}
              </td>
              <td
                className="num mono rc-tcol"
                style={{ fontWeight: 500 }}
              >
                {d.deposit != null ? (
                  <DepositAmount
                    amount={fmtN(d.deposit)}
                    // d.slip is the literal "slip" placeholder when a collection
                    // exists but carries no photo → pass null (not clickable).
                    slipUrl={d.slip && d.slip !== "slip" ? d.slip : null}
                    caption={`ฝาก ${fmtN(d.deposit)} ฿ · ${d.date}`}
                  />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="num mono">
                {d.collectedNotDeposited > 0 ? (
                  makeDayHref ? (
                    <Link
                      href={makeDayHref(d.date)}
                      title="เงินที่แม่บ้านเก็บแล้วยังไม่ฝากธนาคาร · กดดูใครถือ"
                      style={{ color: "var(--warn, #92400e)", fontWeight: 600 }}
                      scroll={false}
                    >
                      {fmtN(d.collectedNotDeposited)}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--warn, #92400e)", fontWeight: 600 }}>
                      {fmtN(d.collectedNotDeposited)}
                    </span>
                  )
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>
                {d.sources.length === 0 ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span
                    style={{
                      display: "inline-flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {d.sources.map((s) => {
                      const meta = sourceBadge(s);
                      return (
                        <span
                          key={s}
                          title={meta.title}
                          className={
                            "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
                            SOURCE_TONE_CLASS[meta.tone]
                          }
                        >
                          {meta.label}
                        </span>
                      );
                    })}
                  </span>
                )}
              </td>
              <td>
                <SlipBadge
                  url={d.slip}
                  missing={!!d.hasCsvWithoutSlip}
                  caption={`สลิปฝากเงิน · ${d.date}`}
                />
              </td>
              <td className={"num mono co-drift " + ledgerDiffClass(d)}>
                {d.collected ? (
                  fmtSigned(d.diff)
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td
                className={"num mono rc-tcol co-drift " + ledgerCumClass(d)}
                style={{ fontWeight: 500 }}
                title={
                  d.writeOffNote
                    ? d.writeOffNote
                    : d.pending > 0
                      ? `รวม pending ${fmtN(d.pending)} ฿ ที่ยังไม่ฝาก`
                      : undefined
                }
              >
                {d.writeOffNet ? (
                  makeDayHref ? (
                    // CEO 2026-06-29: กดกรรไกรแล้วเปิด drill-down วันนั้น เห็น
                    // รายละเอียดการตัดเงิน (กี่บาท ใครตัด เหตุผล ใครอนุมัติ).
                    <Link
                      href={makeDayHref(d.date)}
                      title={
                        (d.writeOffNote ? d.writeOffNote + " · " : "") +
                        "กดดูรายละเอียดการตัดเงิน"
                      }
                      aria-label="กดดูรายละเอียดการตัดเงิน/ตั้งต้นวันนี้"
                      style={{
                        marginRight: 4,
                        cursor: "pointer",
                        textDecoration: "none",
                      }}
                      scroll={false}
                    >
                      ✂️
                    </Link>
                  ) : (
                    <span
                      title={d.writeOffNote ?? undefined}
                      style={{ marginRight: 4, cursor: "help" }}
                      aria-label="มีการตัดเงิน/ตั้งต้นวันนี้"
                    >
                      ✂️
                    </span>
                  )
                ) : null}
                {fmtSigned(d.cumDrift)}
              </td>
            </tr>
          ))}
        </tbody>
        {/* CEO 2026-06-02: ยอดรวม row.  fontWeight + sticky bottom keep it
            anchored when scrolling a long range; ตัวเลข aligns with the row
            columns above. */}
        {totals && ledger.length > 0 && (
          <tfoot>
            <tr
              style={{
                background: "var(--surface-soft)",
                borderTop: "2px solid var(--border-strong)",
                fontWeight: 600,
              }}
            >
              <th style={{ textAlign: "left" }}>
                ยอดรวม{" "}
                <span className="text-3" style={{ fontWeight: 400 }}>
                  ({totals.days} วัน · เก็บ {totals.daysCollected})
                </span>
              </th>
              <td className="num mono">{fmtN(totals.online)}</td>
              <td className="num mono">{fmtN(totals.cash)}</td>
              <td className="num mono" title={`${fmtN(totals.coin)} ครั้ง × 10 บาท`}>
                {fmtN(totals.coinBaht)}
              </td>
              <td className="num mono rc-tcol">{fmtN(totals.cashTotal)}</td>
              <td className="num mono">{fmtN(totals.totalRev)}</td>
              <td className="num mono rc-tcol">{fmtN(totals.deposit)}</td>
              <td
                className="num mono"
                style={
                  totals.collectedNotDeposited > 0
                    ? { color: "var(--warn, #92400e)", fontWeight: 600 }
                    : undefined
                }
              >
                {totals.collectedNotDeposited > 0
                  ? fmtN(totals.collectedNotDeposited)
                  : "—"}
              </td>
              <td />
              <td />
              <td
                className={
                  "num mono co-drift " +
                  (totals.diff < -100
                    ? "crit"
                    : totals.diff > 100
                      ? "ok"
                      : "muted")
                }
              >
                {fmtSigned(totals.diff)}
              </td>
              <td
                className={
                  "num mono rc-tcol co-drift " +
                  (totals.driftEndingEngine > 500
                    ? "crit"
                    : totals.driftEndingEngine > 100
                      ? "warn"
                      : totals.driftEndingEngine < -100
                        ? "ok"
                        : "muted")
                }
                title={
                  totals.pending > 0
                    ? `รวม pending ${fmtN(totals.pending)} ฿ ที่ยังไม่ฝาก ณ วันสุดท้ายในช่วง`
                    : "ไม่มี pending คงค้าง"
                }
              >
                {fmtSigned(-totals.driftEndingEngine)}
              </td>
            </tr>
            {totals.pending > 0 && (
              <tr style={{ background: "var(--surface-soft)" }}>
                <td
                  colSpan={12}
                  className="text-3"
                  style={{ padding: "6px 12px", fontSize: 11 }}
                >
                  · มี pending <strong>{fmtN(totals.pending)} ฿</strong>{" "}
                  ที่ยังไม่ฝาก ณ วันล่าสุดในช่วง (รวมอยู่ในหายสะสมแล้ว) ·
                  engine drift = <strong>{fmtSigned(totals.driftEndingEngine)} ฿</strong>{" "}
                  (positive = ค้างฝาก)
                </td>
              </tr>
            )}
          </tfoot>
        )}
      </table>
      {isOrg && (
        <p className="text-3" style={{ fontSize: 11, padding: "8px 12px" }}>
          ยอดรวมทุกสาขา · เรียงวันใหม่ก่อน
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ledger pager — prev/next for wide / all-time ranges (CEO 2026-06-25)
// Pure server-rendered <a> links · keeps the page-first cache-friendly.
// ─────────────────────────────────────────────────────────────
export function LedgerPager({
  page,
  pageCount,
  total,
  pageSize,
  prevHref,
  nextHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const fromN = page * pageSize + 1;
  const toN = Math.min(total, (page + 1) * pageSize);
  return (
    <div
      className="row"
      style={{
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "10px 14px",
        fontSize: 12.5,
      }}
    >
      <span className="text-3">
        แสดงวันที่ <strong className="mono">{fromN}</strong>–
        <strong className="mono">{toN}</strong> จาก{" "}
        <strong className="mono">{total}</strong> วัน · หน้า {page + 1}/{pageCount}
      </span>
      <span className="row gap-2">
        {prevHref ? (
          <Link href={prevHref} className="btn btn-sm" scroll={false}>
            <ChevronLeft size={13} aria-hidden="true" /> ใหม่กว่า
          </Link>
        ) : (
          <span className="btn btn-sm" aria-disabled="true" style={{ opacity: 0.4 }}>
            <ChevronLeft size={13} aria-hidden="true" /> ใหม่กว่า
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} className="btn btn-sm" scroll={false}>
            เก่ากว่า <ChevronRight size={13} aria-hidden="true" />
          </Link>
        ) : (
          <span className="btn btn-sm" aria-disabled="true" style={{ opacity: 0.4 }}>
            เก่ากว่า <ChevronRight size={13} aria-hidden="true" />
          </span>
        )}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Day-detail drill-down — the individual collection rounds + bank
// deposits that make up ONE day's numbers (CEO 2026-06-25). Server-
// rendered; opened via ?day=YYYY-MM-DD, closed via the X link.
// ─────────────────────────────────────────────────────────────
// CEO 2026-06-29: one row of the "แยกตามที่มาของเงิน" panel — keeps the icon,
// label, count and money aligned so the CSV vs maid split reads at a glance.
function SourceSplitRow({
  icon,
  label,
  count,
  total,
  unit = "ก้อน",
  tone,
}: {
  icon: string;
  label: string;
  count: number;
  total: number;
  unit?: string;
  tone: string;
}) {
  return (
    <div
      className={tone}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        fontSize: 12.5,
      }}
    >
      <span style={{ fontSize: 15 }} aria-hidden="true">
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <span className="text-3" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
        {count} {unit}
      </span>
      <strong
        className="mono"
        style={{ fontSize: 13, minWidth: 78, textAlign: "right" }}
      >
        {fmtN(total)} ฿
      </strong>
    </div>
  );
}

export function DayDetailPanel({
  detail,
  closeHref,
}: {
  detail: ReconcileDayDetail;
  closeHref: string;
}) {
  const hasNothing =
    detail.collections.length === 0 &&
    detail.deposits.length === 0 &&
    detail.writeOffs.length === 0;
  return (
    <div
      className="card"
      style={{
        margin: "0 0 12px",
        padding: 0,
        overflow: "hidden",
        borderColor: "var(--accent)",
      }}
    >
      <div
        className="row"
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          background: "var(--accent-soft)",
          borderBottom: "1px solid var(--accent)",
        }}
      >
        <strong style={{ fontSize: 13.5 }}>
          รายการย่อยของวันที่ <span className="mono">{detail.date}</span>
        </strong>
        <Link href={closeHref} className="btn btn-sm" title="ปิด" scroll={false}>
          <X size={13} aria-hidden="true" /> ปิด
        </Link>
      </div>

      <div style={{ padding: "10px 14px", display: "grid", gap: 14 }}>
        {/* summary chips — CEO 2026-06-29: ซ่อนชิปยอด 0 (วันที่มีแต่ตัดเงิน
            จะได้ไม่โชว์ "ยังไม่ฝาก 0" สีเหลืองเตือนชวนงง) */}
        {(detail.collectedTotal > 0 ||
          detail.collectedNotDepositedTotal > 0 ||
          detail.depositTotal > 0) && (
          <div className="row gap-2" style={{ flexWrap: "wrap", fontSize: 12 }}>
            {detail.collectedTotal > 0 && (
              <span className="chip">
                เก็บรวม <strong className="mono">{fmtN(detail.collectedTotal)}</strong> ฿
              </span>
            )}
            {detail.collectedNotDepositedTotal > 0 && (
              <span
                className="chip"
                style={{ background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e" }}
              >
                ยังไม่ฝาก{" "}
                <strong className="mono">{fmtN(detail.collectedNotDepositedTotal)}</strong> ฿
              </span>
            )}
            {detail.depositTotal > 0 && (
              <span className="chip">
                ฝากเข้าธนาคาร <strong className="mono">{fmtN(detail.depositTotal)}</strong> ฿
              </span>
            )}
          </div>
        )}

        {/* CEO 2026-06-29: แยกชัดว่าเงินก้อนนี้มาจาก CSV หรือแม่บ้านฝากจริง —
            ไม่ต้องเดาจากป้ายเล็ก ๆ ในแต่ละแถวอีก */}
        {(detail.bySource.maidManual.count > 0 ||
          detail.bySource.csvImport.count > 0 ||
          detail.bySource.officeProxy.count > 0 ||
          detail.deposits.length > 0) && (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              className="text-3"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: "7px 12px",
                background: "var(--surface-soft)",
              }}
            >
              แยกตามที่มาของเงิน
            </div>
            {detail.bySource.maidManual.count > 0 && (
              <SourceSplitRow
                icon="💵"
                label="แม่บ้านบันทึกเอง (มือ)"
                count={detail.bySource.maidManual.count}
                total={detail.bySource.maidManual.total}
                tone="bg-zinc-50"
              />
            )}
            {detail.bySource.csvImport.count > 0 && (
              <SourceSplitRow
                icon="📥"
                label="นำเข้าจาก CSV"
                count={detail.bySource.csvImport.count}
                total={detail.bySource.csvImport.total}
                tone="bg-amber-50"
              />
            )}
            {detail.bySource.officeProxy.count > 0 && (
              <SourceSplitRow
                icon="🏢"
                label="สำนักงานบันทึกแทน"
                count={detail.bySource.officeProxy.count}
                total={detail.bySource.officeProxy.total}
                tone="bg-sky-50"
              />
            )}
            {detail.deposits.length > 0 && (
              <SourceSplitRow
                icon="🏦"
                label="ฝากเข้าธนาคารจริง"
                count={detail.deposits.length}
                total={detail.depositTotal}
                unit="ครั้ง"
                tone="bg-emerald-50"
              />
            )}
          </div>
        )}

        {hasNothing && (
          <p className="text-3" style={{ fontSize: 12 }}>
            วันนี้ไม่มีรายการเก็บเงินหรือฝากเงิน (มีแต่ยอดขาย POS)
          </p>
        )}

        {/* collections */}
        {detail.collections.length > 0 && (
          <div>
            <div
              className="text-3"
              style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}
            >
              แม่บ้านเก็บเงิน ({detail.collections.length} ก้อน)
            </div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>แม่บ้าน</th>
                  <th className="num">จำนวน</th>
                  <th>ที่มา</th>
                  <th>สถานะ</th>
                  <th>สลิป</th>
                </tr>
              </thead>
              <tbody>
                {detail.collections.map((c) => {
                  const meta = sourceBadge(c.source);
                  return (
                    <tr key={c.id}>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {c.collectedAt}
                      </td>
                      <td>{c.maidName}</td>
                      <td className="num mono">{fmtN(c.countedAmount)}</td>
                      <td>
                        <span
                          title={meta.title}
                          className={
                            "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
                            SOURCE_TONE_CLASS[meta.tone]
                          }
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        {c.deposited ? (
                          <span style={{ color: "var(--ok)", fontWeight: 600 }}>
                            ฝากแล้ว
                          </span>
                        ) : (
                          <span
                            style={{ color: "#92400e", fontWeight: 600 }}
                            className="row gap-1"
                          >
                            <Clock size={11} aria-hidden="true" />
                            ยังไม่ฝาก
                            {c.daysHeld != null && c.daysHeld > 0 && (
                              <span className="text-3">· ถือมา {c.daysHeld} วัน</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        {c.slipUrl ? (
                          <a
                            href={c.slipUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rc-slip"
                          >
                            <Paperclip size={10} aria-hidden="true" /> ดู
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* deposits */}
        {detail.deposits.length > 0 && (
          <div>
            <div
              className="text-3"
              style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}
            >
              ฝากเข้าธนาคาร ({detail.deposits.length} ครั้ง)
            </div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>โดย</th>
                  <th className="num">ยอดฝาก</th>
                  <th className="num">ค่าธรรมเนียม</th>
                  <th>สลิป</th>
                </tr>
              </thead>
              <tbody>
                {detail.deposits.map((d) => (
                  <tr key={d.id}>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {d.depositedAt}
                    </td>
                    <td>{d.maidName}</td>
                    <td className="num mono">{fmtN(d.depositedAmount)}</td>
                    <td className="num mono">{d.bankFee ? fmtN(d.bankFee) : "—"}</td>
                    <td>
                      {d.slipUrl ? (
                        <a
                          href={d.slipUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rc-slip"
                        >
                          <Paperclip size={10} aria-hidden="true" /> ดู
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* write-offs effective today — CEO 2026-06-29: กดกรรไกร ✂️ จากตาราง
            มาที่นี่ เห็นเลยว่าตัดกี่บาท ใครตัด เหตุผลอะไร ใครอนุมัติ */}
        {detail.writeOffs.length > 0 && (
          <div>
            <div
              className="text-3"
              style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}
            >
              ✂️ ตัดเงิน / ตั้งต้น ({detail.writeOffs.length} รายการ)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {detail.writeOffs.map((w) => {
                const isOver = w.direction === "OVER";
                const approved = w.status === "APPROVED";
                return (
                  <div
                    key={w.id}
                    style={{
                      borderRadius: 8,
                      border: "1px solid",
                      borderColor: approved
                        ? "var(--ok-border)"
                        : "var(--crit-border)",
                      background: approved ? "var(--ok-soft)" : "var(--crit-soft)",
                      padding: "8px 10px",
                      fontSize: 12,
                    }}
                  >
                    <div
                      className="row"
                      style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      <strong className="mono" style={{ fontSize: 13.5 }}>
                        {fmtN(w.amount)} ฿
                      </strong>
                      <span
                        className="chip"
                        style={{
                          fontSize: 10,
                          color: isOver ? "var(--accent)" : "var(--crit)",
                        }}
                      >
                        {isOver ? "เงินเกิน" : "เงินขาด"}
                      </span>
                      <span
                        className="chip"
                        style={{
                          fontSize: 10,
                          color: approved ? "var(--ok)" : "var(--crit)",
                        }}
                      >
                        {approved ? "อนุมัติแล้ว · มีผลกับยอด" : "รออนุมัติ"}
                      </span>
                    </div>
                    <div className="text-2" style={{ fontSize: 12, marginTop: 3 }}>
                      เหตุผล: {w.reason}
                    </div>
                    <div className="text-3" style={{ fontSize: 11, marginTop: 2 }}>
                      ขอโดย {w.makerName} · {w.makerAt}
                      {w.approverName
                        ? ` · อนุมัติโดย ${w.approverName}${
                            w.approverAt ? ` · ${w.approverAt}` : ""
                          }`
                        : ""}
                    </div>
                    {w.effectiveDate && (
                      <div className="text-3" style={{ fontSize: 11, marginTop: 1 }}>
                        ตั้งต้นยอดใหม่ ณ {w.effectiveDate}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Per-chair tab — deep dive (CEO 2026-06-29): POS sales (ควรได้) vs maid-
// collected (เก็บได้) per massage chair → which machine is short/over.
// ─────────────────────────────────────────────────────────────
const PERCHAIR_TOL = 20; // ±฿ band counted as "ตรง" (rounding/coin slack)

function perChairStatus(r: PerChairRow): {
  emoji: string;
  label: string;
  color: string;
} {
  if (!r.hasCollection && r.hasPos)
    return { emoji: "⚪", label: "ยังไม่เก็บ", color: "var(--text-3)" };
  if (!r.hasPos && r.hasCollection)
    return { emoji: "⚪", label: "ไม่มี POS", color: "var(--text-3)" };
  if (!r.hasPos && !r.hasCollection)
    return { emoji: "⚪", label: "ไม่มีข้อมูล", color: "var(--text-3)" };
  if (r.variance < -PERCHAIR_TOL)
    return { emoji: "🔴", label: "ขาด", color: "var(--crit)" };
  if (r.variance > PERCHAIR_TOL)
    return { emoji: "🟡", label: "เกิน", color: "#92400e" };
  return { emoji: "🟢", label: "ตรง", color: "var(--ok)" };
}

export function PerChairTab({
  data,
  isOrg,
}: {
  data: ReconcilePerChair | null;
  isOrg: boolean;
}) {
  if (isOrg) {
    return (
      <div
        className="card"
        style={{ margin: "12px 0", padding: 18, fontSize: 13 }}
      >
        🔍 <strong>เลือกสาขาก่อน</strong> — มุมมอง “รายตู้” ดูเชิงลึกทีละสาขา
        (กดสาขาทางซ้าย)
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card" style={{ margin: "12px 0", padding: 18, fontSize: 13 }}>
        ยังไม่มีข้อมูล
      </div>
    );
  }
  const {
    rows,
    totals,
    unattributedCollected,
    unattributedCount,
    unattributedExpected,
    unattributedExpectedCount,
  } = data;
  const posChairs = rows.filter((r) => r.hasPos).length;
  const totalVarColor =
    totals.variance < -PERCHAIR_TOL
      ? "var(--crit)"
      : totals.variance > PERCHAIR_TOL
        ? "#92400e"
        : "var(--ok)";
  return (
    <div className="rc-ledger">
      <div className="text-3" style={{ fontSize: 11.5, padding: "6px 2px 4px" }}>
        เทียบ “ยอดขายต่อตู้ (POS · ควรได้)” กับ “แม่บ้านเก็บได้ต่อตู้” ช่วง{" "}
        <strong className="mono">{data.from}</strong> –{" "}
        <strong className="mono">{data.to}</strong> · ติดลบ 🔴 = เงินขาดที่ตู้นั้น
      </div>

      <div
        className="row gap-2"
        style={{ flexWrap: "wrap", fontSize: 12, margin: "2px 0 8px" }}
      >
        <span className="chip">
          ควรได้รวม <strong className="mono">{fmtN(totals.expected)}</strong> ฿
        </span>
        <span className="chip">
          เก็บได้รวม <strong className="mono">{fmtN(totals.collected)}</strong> ฿
        </span>
        <span className="chip" style={{ color: totalVarColor, fontWeight: 600 }}>
          ขาด/เกินรวม <strong className="mono">{fmtSigned(totals.variance)}</strong> ฿
        </span>
      </div>

      {unattributedCount > 0 && (
        <div
          className="card"
          style={{
            margin: "0 0 8px",
            padding: "8px 12px",
            fontSize: 12,
            background: "#fffbeb",
            borderColor: "#fcd34d",
            color: "#92400e",
          }}
        >
          ⚠️ มีเงินเก็บ{" "}
          <strong className="mono">{fmtN(unattributedCollected)}</strong> ฿ จาก{" "}
          {unattributedCount} รอบ ที่นำเข้าด้วย CSV — ไม่ได้แยกรายตู้ จึงไม่อยู่ในตารางข้างล่าง
          (แต่รวมอยู่ใน “เก็บได้รวม” แล้ว)
        </div>
      )}

      {unattributedExpectedCount > 0 && (
        <div
          className="card"
          style={{
            margin: "0 0 8px",
            padding: "8px 12px",
            fontSize: 12,
            background: "#fffbeb",
            borderColor: "#fcd34d",
            color: "#92400e",
          }}
        >
          ⚠️ มียอดขาย POS{" "}
          <strong className="mono">{fmtN(unattributedExpected)}</strong> ฿ ที่ไม่มีรหัสตู้ —
          ไม่อยู่ในตารางข้างล่าง (แต่รวมอยู่ใน “ควรได้รวม” แล้ว)
        </div>
      )}

      {rows.length > 0 && posChairs === 0 && (
        <div
          className="card"
          style={{
            margin: "0 0 8px",
            padding: "8px 12px",
            fontSize: 12,
            background: "var(--surface-soft)",
          }}
        >
          ℹ️ ช่วงนี้ยังไม่มี “ยอดขายรายตู้” — POS อาจอัปแบบรวมสาขา (ไม่ได้แยกเครื่อง)
          จึงเทียบขาด/เกินรายตู้ยังไม่ได้ · ดูได้เฉพาะ “แม่บ้านเก็บได้” รายตู้
        </div>
      )}

      {rows.length === 0 ? (
        <div
          className="text-3"
          style={{ textAlign: "center", padding: "40px 0", fontSize: 12.5 }}
        >
          ยังไม่มีข้อมูลรายตู้ในช่วงนี้ — ต้องมีแม่บ้านกรอกในแอป (ไม่ใช่ CSV) + POS อัพแล้ว
        </div>
      ) : (
        <table className="tbl rc-ledger-tbl">
          <thead>
            <tr>
              <th>เก้าอี้</th>
              <th className="num">ยอดขาย (ควรได้)</th>
              <th className="num">แม่บ้านเก็บได้</th>
              <th className="num rc-tcol">ขาด/เกิน</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = perChairStatus(r);
              const showVar = r.hasPos && r.hasCollection;
              return (
                <tr key={r.chairCode}>
                  <td>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {r.chairCode}
                    </span>
                    {r.generation && (
                      <span className="text-3" style={{ fontSize: 10.5, marginLeft: 6 }}>
                        {r.generation}
                      </span>
                    )}
                  </td>
                  <td className="num mono">
                    {r.hasPos ? fmtN(r.expected) : <span className="text-muted">—</span>}
                  </td>
                  <td className="num mono">
                    {r.hasCollection ? (
                      fmtN(r.collected)
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td
                    className="num mono rc-tcol"
                    style={{ color: showVar ? st.color : undefined, fontWeight: 600 }}
                  >
                    {showVar ? fmtSigned(r.variance) : <span className="text-muted">—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <span style={{ color: st.color }}>
                      {st.emoji} {st.label}
                    </span>
                    {r.brokenOrEmpty && (
                      <span
                        className="text-3"
                        style={{ fontSize: 10.5, marginLeft: 6 }}
                        title="แม่บ้านระบุว่าตู้นี้บางช่องไม่ปกติ (เสีย/ว่าง/ข้าม)"
                      >
                        ⚠️ ตู้มีปัญหา
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Per-chair DETAIL — long per-DAY × per-chair matrix (CEO 2026-06-29)
// ─────────────────────────────────────────────────────────────
function cumColor(cum: number): string {
  if (cum < -500) return "var(--crit)";
  if (cum < -100) return "#b45309";
  if (cum > 100) return "var(--ok)";
  return "var(--text-3, #888)";
}

export function PerChairViewToggle({
  summaryHref,
  dailyHref,
  active,
}: {
  summaryHref: string;
  dailyHref: string;
  active: "summary" | "daily";
}) {
  return (
    <div className="rc-tabs-row" style={{ marginTop: 4 }}>
      <div className="rc-tabs">
        <Link
          href={dailyHref}
          className="rc-tab"
          data-active={active === "daily" ? "" : undefined}
          scroll={false}
        >
          📅 รายวัน (ละเอียด)
        </Link>
        <Link
          href={summaryHref}
          className="rc-tab"
          data-active={active === "summary" ? "" : undefined}
          scroll={false}
        >
          📊 สรุปรวม
        </Link>
      </div>
    </div>
  );
}

function PerChairDayRow({ c }: { c: PerChairDetailCell }) {
  const showVar = c.hasCollection;
  const st = showVar
    ? c.variance < -PERCHAIR_TOL
      ? { emoji: "🔴", label: "ขาด", color: "var(--crit)" }
      : c.variance > PERCHAIR_TOL
        ? { emoji: "🟡", label: "เกิน", color: "#92400e" }
        : { emoji: "🟢", label: "ตรง", color: "var(--ok)" }
    : { emoji: "⚪", label: "ยังไม่เก็บรายตู้", color: "var(--text-3, #888)" };
  return (
    <tr>
      <td>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {c.chairCode}
        </span>
        {c.generation && (
          <span className="text-3" style={{ fontSize: 10.5, marginLeft: 6 }}>
            {c.generation}
          </span>
        )}
      </td>
      <td className="num mono">
        {c.hasPos ? fmtN(c.expected) : <span className="text-muted">—</span>}
      </td>
      <td className="num mono">
        {c.hasCollection ? (
          fmtN(c.collected)
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td
        className="num mono rc-tcol"
        style={{ color: showVar ? st.color : undefined, fontWeight: 600 }}
      >
        {showVar ? fmtSigned(c.variance) : <span className="text-muted">—</span>}
      </td>
      <td
        className="num mono"
        style={{
          color: showVar ? cumColor(c.cumVariance) : "var(--text-3, #999)",
          fontSize: 11.5,
        }}
        title="ขาด/เกินสะสมของตู้นี้ในช่วงที่เลือก"
      >
        {fmtSigned(c.cumVariance)}
      </td>
      <td style={{ fontSize: 11.5 }}>
        <span style={{ color: st.color }}>
          {st.emoji} {st.label}
        </span>
        {c.broken && (
          <span
            className="text-3"
            style={{ fontSize: 10, marginLeft: 4 }}
            title="แม่บ้านระบุว่าตู้นี้บางช่องไม่ปกติ (เสีย/ว่าง/ข้าม)"
          >
            ⚠️
          </span>
        )}
      </td>
    </tr>
  );
}

function PerChairDayBlock({ day }: { day: PerChairDay }) {
  const s = day.summary;
  const hasColl =
    s.collectedMaidManual ||
    s.collectedCsvImport ||
    s.collectedOfficeProxy ||
    s.unattributedCollected;
  const hasDep = s.depositMaid || s.depositOffice || s.depositUnknown;
  const hasWO = s.writeOffShort || s.writeOffOver;
  const varColor =
    day.varianceTotal < -PERCHAIR_TOL
      ? "var(--crit)"
      : day.varianceTotal > PERCHAIR_TOL
        ? "#92400e"
        : "var(--ok)";
  return (
    <div
      className="card"
      style={{ margin: "0 0 12px", padding: 0, overflow: "hidden" }}
    >
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px 12px",
          background: "var(--surface-soft)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
            {day.date}
          </span>
          <span className="text-3" style={{ marginLeft: 6, fontSize: 11 }}>
            {dayOfWeekTh(day.date)}
          </span>
        </div>
        <div className="text-3" style={{ fontSize: 11.5 }}>
          ขาย <strong className="mono">{fmtN(day.expectedTotal)}</strong> · เก็บ{" "}
          <strong className="mono">{fmtN(day.collectedTotal)}</strong> ·{" "}
          <span style={{ color: varColor, fontWeight: 600 }}>
            {fmtSigned(day.varianceTotal)}
          </span>
          {day.depositTotal > 0 && (
            <>
              {" "}
              · ฝาก <strong className="mono">{fmtN(day.depositTotal)}</strong>
            </>
          )}
        </div>
      </div>

      {day.chairs.length > 0 ? (
        <table className="tbl rc-ledger-tbl" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>เก้าอี้</th>
              <th className="num">ยอดขาย</th>
              <th className="num">เก็บได้</th>
              <th className="num rc-tcol">ขาด/เกินวันนี้</th>
              <th className="num">สะสม</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {day.chairs.map((c) => (
              <PerChairDayRow key={c.chairCode} c={c} />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-3" style={{ padding: 12, fontSize: 12 }}>
          วันนี้ไม่มียอดขาย/เก็บแยกรายตู้
        </div>
      )}

      <div
        className="row gap-1"
        style={{
          flexWrap: "wrap",
          alignItems: "center",
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          fontSize: 11.5,
          background: "var(--surface-soft)",
        }}
      >
        <span className="text-3" style={{ fontWeight: 600 }}>
          สรุปเงินวันนี้:
        </span>
        {s.collectedMaidManual > 0 && (
          <span className="chip">💵 แม่บ้านมือ {fmtN(s.collectedMaidManual)}</span>
        )}
        {s.collectedCsvImport > 0 && (
          <span
            className="chip"
            style={{ background: "#fffbeb", color: "#92400e" }}
            title="เก็บผ่านไฟล์ CSV — ไม่มีแยกรายตู้"
          >
            📥 CSV {fmtN(s.collectedCsvImport)}
          </span>
        )}
        {s.collectedOfficeProxy > 0 && (
          <span className="chip">🏢 ออฟฟิศเก็บ {fmtN(s.collectedOfficeProxy)}</span>
        )}
        {s.depositMaid > 0 && (
          <span className="chip">🏦 ฝากแม่บ้าน {fmtN(s.depositMaid)}</span>
        )}
        {s.depositOffice > 0 && (
          <span className="chip">🏦 ฝากแอดมิน {fmtN(s.depositOffice)}</span>
        )}
        {s.depositUnknown > 0 && (
          <span className="chip text-3" title="แถวฝากเก่าที่ยังไม่ระบุผู้ฝาก">
            🏦 ฝาก(ไม่ระบุ) {fmtN(s.depositUnknown)}
          </span>
        )}
        {s.writeOffShort > 0 && (
          <span className="chip" style={{ color: "var(--crit)" }}>
            ✂️ ตัดขาด {fmtN(s.writeOffShort)}
          </span>
        )}
        {s.writeOffOver > 0 && (
          <span className="chip" style={{ color: "#92400e" }}>
            ✂️ ตัดเกิน {fmtN(s.writeOffOver)}
          </span>
        )}
        {!hasColl && !hasDep && !hasWO && (
          <span className="text-3">— ไม่มีการเก็บ/ฝาก/ตัดเงิน</span>
        )}
      </div>
    </div>
  );
}

export function PerChairDetailTab({
  data,
  isOrg,
}: {
  data: ReconcilePerChairDetail | null;
  isOrg: boolean;
}) {
  if (isOrg) {
    return (
      <div
        className="card"
        style={{ margin: "12px 0", padding: 18, fontSize: 13 }}
      >
        🔍 <strong>เลือกสาขาก่อน</strong> — มุมมอง “รายตู้ · รายวัน” ดูทีละสาขา
        (กดสาขาทางซ้าย)
      </div>
    );
  }
  if (!data || data.days.length === 0) {
    return (
      <div
        className="card"
        style={{ margin: "12px 0", padding: 18, fontSize: 13 }}
      >
        ยังไม่มีข้อมูลรายตู้-รายวันในช่วงนี้ — ต้องมีแม่บ้านกรอกในแอป (ไม่ใช่ CSV)
        + POS อัพแล้ว
      </div>
    );
  }
  return (
    <div className="rc-ledger">
      <div
        className="text-3"
        style={{ fontSize: 11.5, padding: "6px 2px 4px" }}
      >
        แยกราย <strong>วัน × ตู้</strong> · ช่วง{" "}
        <strong className="mono">{data.from}</strong> –{" "}
        <strong className="mono">{data.to}</strong> · “สะสม” =
        ขาด/เกินรายตู้สะสมในช่วงนี้ · ⚪ = วันนั้นยังไม่กรอกรายตู้
        (เงินอยู่ในสรุปท้ายวัน)
      </div>
      {data.truncated && (
        <div
          className="card"
          style={{
            margin: "0 0 8px",
            padding: "8px 12px",
            fontSize: 12,
            background: "var(--surface-soft)",
          }}
        >
          ℹ️ แสดง {data.maxDays} วันล่าสุดของช่วงที่เลือก
          (ตารางรายวันยาวมาก) — เลือกช่วงวันเองด้านบนเพื่อดูช่วงเก่ากว่า
        </div>
      )}
      {data.days.map((d) => (
        <PerChairDayBlock key={d.date} day={d} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Timeline tab — cumulative POS vs cumulative deposit (pure SVG)
// ─────────────────────────────────────────────────────────────
export function TimelineTab({ series }: { series: TimelinePoint[] }) {
  const W = 880;
  const H = 320;
  const P = 40;
  const maxY = Math.max(...series.map((d) => d.cumPos), 1);
  const x = (i: number) =>
    P + (i / (series.length - 1 || 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / maxY) * (H - P * 2);

  const posPath = series
    .map((d, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(d.cumPos))
    .join(" ");
  const depPath = series
    .map((d, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(d.cumDep))
    .join(" ");
  const gapArea =
    posPath +
    " " +
    series
      .slice()
      .reverse()
      .map((d, i) => "L" + x(series.length - 1 - i) + "," + y(d.cumDep))
      .join(" ") +
    " Z";

  const xLabels = series.filter(
    (_, i) => i % 7 === 0 || i === series.length - 1,
  );
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    v: p * maxY,
    y: y(p * maxY),
  }));

  return (
    <div className="rc-timeline">
      <div className="rc-timeline-legend">
        <span className="row gap-1">
          <span className="dot" style={{ background: "var(--text-2)" }} /> POS
          สะสม
        </span>
        <span className="row gap-1">
          <span className="dot" style={{ background: "var(--accent)" }} />{" "}
          แม่บ้านเก็บสะสม
        </span>
        <span className="row gap-1">
          <span
            style={{
              width: 14,
              height: 8,
              background: "var(--crit)",
              opacity: 0.18,
              display: "inline-block",
            }}
          />{" "}
          ช่องว่าง = ยังไม่ได้เก็บ
        </span>
        <span className="row gap-1">
          <span className="dot" style={{ background: "var(--ok)" }} /> เก็บเงิน
          event
        </span>
      </div>
      {series.length === 0 ? (
        <p className="text-3" style={{ padding: "48px 0", textAlign: "center" }}>
          ยังไม่มีข้อมูลให้วาดกราฟ
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ maxHeight: 360 }}
          role="img"
          aria-label="ไทม์ไลน์ POS สะสม เทียบ แม่บ้านเก็บสะสม"
        >
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={P}
                x2={W - P}
                y1={t.y}
                y2={t.y}
                stroke="var(--border-subtle)"
              />
              <text
                x={P - 6}
                y={t.y + 3}
                fontSize="10"
                fill="var(--text-3)"
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {fmtN(t.v)}
              </text>
            </g>
          ))}
          <path d={gapArea} fill="var(--crit)" opacity="0.10" />
          <path
            d={posPath}
            fill="none"
            stroke="var(--text-2)"
            strokeWidth="1.8"
            strokeDasharray="4 3"
          />
          <path d={depPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          {series.map(
            (d, i) =>
              d.collected && (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(d.cumDep)}
                  r="3.5"
                  fill="var(--ok)"
                  stroke="white"
                  strokeWidth="1.5"
                />
              ),
          )}
          {xLabels.map((d, i) => {
            const idx = series.indexOf(d);
            return (
              <text
                key={i}
                x={x(idx)}
                y={H - P + 16}
                fontSize="10"
                fill="var(--text-3)"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {d.date.slice(5)}
              </text>
            );
          })}
          <line
            x1={x(series.length - 1)}
            x2={x(series.length - 1)}
            y1={P}
            y2={H - P}
            stroke="var(--accent)"
            strokeDasharray="3 3"
            opacity="0.4"
          />
          <text
            x={x(series.length - 1)}
            y={P - 6}
            fontSize="10"
            fill="var(--accent)"
            textAnchor="end"
          >
            วันนี้
          </text>
        </svg>
      )}
      <div className="rc-timeline-note">
        <Info size={12} aria-hidden="true" />
        <span>
          ช่องว่างสีแดง = pending balance ระหว่างเก็บ · ทุกครั้งที่แม่บ้านมาเก็บ
          ช่องว่างควร <strong>ปิดเป็นศูนย์</strong> · ถ้าเก็บแล้วยัง
          <strong>ห่างกว่าเดิม</strong> = drift growing = ทุจริต
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Periods tab — between-collection windows
// ─────────────────────────────────────────────────────────────
export function PeriodsTab({
  periods,
  branchId,
}: {
  periods: PeriodWindow[];
  branchId: string | null;
}) {
  if (periods.length === 0) {
    return (
      <p className="text-3" style={{ padding: "48px 0", textAlign: "center" }}>
        ยังไม่มีรอบเก็บ
      </p>
    );
  }
  return (
    <div className="rc-periods">
      {periods.map((p, i) => (
        <div
          key={i}
          className={"rc-period " + (p.open ? "open" : "")}
          data-intent={p.intent}
        >
          <div className="rc-period-head">
            <div className="rc-period-range">
              <span className="mono">{p.from.slice(5)}</span>
              <span className="text-3">→</span>
              <span className="mono">{p.to.slice(5)}</span>
              <span
                className="chip"
                style={{ padding: "1px 6px", fontSize: 10.5 }}
              >
                {p.days} วัน
              </span>
              {p.open && (
                <span
                  className="chip chip-warn"
                  style={{ padding: "1px 6px", fontSize: 10.5 }}
                >
                  ⏳ ยังไม่เก็บ
                </span>
              )}
            </div>
            <div className="rc-period-cum">
              <span className="text-3">cumulative</span>
              <span
                className={
                  "mono " +
                  (p.cumAfter < -500
                    ? "co-drift crit"
                    : p.cumAfter < -100
                      ? "co-drift warn"
                      : "")
                }
              >
                {fmtSigned(p.cumBefore)} → {fmtSigned(p.cumAfter)}
              </span>
            </div>
          </div>
          <div className="rc-period-grid">
            <div className="rc-period-cell">
              <div className="rc-period-label">รายได้รวม</div>
              <div className="rc-period-value mono">{fmtN(p.posSum)} ฿</div>
            </div>
            <div className="rc-period-cell">
              <div className="rc-period-label">เงินสด</div>
              <div className="rc-period-value mono">{fmtN(p.cashSum)} ฿</div>
              <div className="rc-period-sub">คาดว่าแม่บ้านควรส่ง</div>
            </div>
            <div className="rc-period-cell">
              <div className="rc-period-label">
                {p.open ? "Pending" : "แม่บ้านส่ง"}
              </div>
              <div className="rc-period-value mono">
                {p.open
                  ? fmtN(p.cashSum) + " ฿"
                  : p.deposit != null
                    ? fmtN(p.deposit) + " ฿"
                    : "—"}
              </div>
              {p.slip && (
                <div className="rc-period-sub">
                  <span className="rc-slip">
                    <Paperclip size={10} aria-hidden="true" /> สลิป
                  </span>
                </div>
              )}
            </div>
            <div className="rc-period-cell">
              <div className="rc-period-label">ต่าง (diff)</div>
              <div
                className={
                  "rc-period-value mono " +
                  (p.open
                    ? ""
                    : Math.abs(p.diff ?? 0) < 100
                      ? "co-drift ok"
                      : "co-drift crit")
                }
              >
                {p.open ? (
                  <span className="text-3">—</span>
                ) : (
                  fmtSigned(p.diff) + " ฿"
                )}
              </div>
              {!p.open && (
                <div className="rc-period-sub">
                  {Math.abs(p.diff ?? 0) < 100
                    ? "✓ ตรงพอดี"
                    : (p.diff ?? 0) < 0
                      ? "ขาด"
                      : "เกิน"}
                </div>
              )}
            </div>
          </div>
          {!p.open && (
            <div className="rc-period-actions">
              {branchId && (
                <Link
                  href={`/chairops/reconcile/${branchId}`}
                  className="btn btn-sm btn-ghost"
                  scroll={false}
                >
                  <Eye size={11} aria-hidden="true" /> ดูรายวัน
                </Link>
              )}
              {Math.abs(p.diff ?? 0) >= 100 && (p.diff ?? 0) < 0 && branchId && (
                <Link
                  href={`/chairops/reconcile/${branchId}#write-off`}
                  className="btn btn-sm"
                >
                  <Minus size={11} aria-hidden="true" /> สร้าง write-off
                </Link>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// re-export baht so the page can keep one import surface if needed
export { baht };
