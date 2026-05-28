// Reconcile v2 server-rendered views — Hero · Freshness · Ledger · Timeline ·
// Periods. All pure server components (no client JS). SVG charts are hand-rolled
// (no chart lib) — mockup proves plain SVG renders the timeline + sparkline.
//
// Thai labels are verbatim from the mockup. Currency uses baht(n, true) for
// signed values per the spec.

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
} from "lucide-react";
import { baht } from "@/lib/chairops/utils/format";
import {
  ledgerCumClass,
  ledgerDiffClass,
  type LedgerDay,
  type ReconcileFreshness,
  type ReconcileOverview,
  type TimelinePoint,
  type PeriodWindow,
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
  active: "ledger" | "timeline" | "periods";
}) {
  const tab = (key: "ledger" | "timeline" | "periods", label: string) => {
    const href =
      key === "ledger" ? baseHref : `${baseHref}?view=${key}`;
    return (
      <a
        href={href}
        className="rc-tab"
        data-active={active === key ? "" : undefined}
      >
        {label}
      </a>
    );
  };
  return (
    <div className="rc-tabs-row">
      <div className="rc-tabs">
        {tab("ledger", "Ledger")}
        {tab("timeline", "Timeline")}
        {tab("periods", "รอบเก็บ (Periods)")}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ledger tab — bank-statement table
// ─────────────────────────────────────────────────────────────
export function LedgerTab({
  ledger,
  isOrg,
}: {
  ledger: LedgerDay[];
  isOrg: boolean;
}) {
  return (
    <div className="rc-ledger">
      <table className="tbl rc-ledger-tbl">
        <thead>
          <tr>
            <th>วันที่</th>
            <th className="num">ออนไลน์</th>
            <th className="num">เงินสด</th>
            <th className="num">เหรียญ</th>
            <th className="num rc-tcol">รวมเงินสด</th>
            <th className="num">รายได้รวม</th>
            <th className="num rc-tcol">ฝาก</th>
            <th>สลิป</th>
            <th className="num">หาย</th>
            <th className="num rc-tcol">หายสะสม</th>
          </tr>
        </thead>
        <tbody>
          {ledger.length === 0 && (
            <tr>
              <td
                colSpan={10}
                style={{ textAlign: "center", padding: "48px 0" }}
                className="text-3"
              >
                ยังไม่มีข้อมูล · อัพ POS แล้ว Recompute ก่อน
              </td>
            </tr>
          )}
          {ledger.map((d) => (
            <tr key={d.date} className={d.collected ? "rc-row-collected" : ""}>
              <td>
                <div className="rc-date">
                  <span className="mono" style={{ fontSize: 12 }}>
                    {d.date.slice(5)}
                  </span>
                  <span className="text-3" style={{ fontSize: 10.5 }}>
                    {dayOfWeekTh(d.date)}
                  </span>
                </div>
              </td>
              <td className="num mono">{fmtN(d.online)}</td>
              <td className="num mono">{fmtN(d.cash)}</td>
              <td className="num mono">{fmtN(d.coin)}</td>
              <td className="num mono rc-tcol">{fmtN(d.cashTotal)}</td>
              <td className="num mono" style={{ fontWeight: 500 }}>
                {fmtN(d.totalRev)}
              </td>
              <td
                className="num mono rc-tcol"
                style={{ fontWeight: 500 }}
              >
                {d.deposit != null ? (
                  fmtN(d.deposit)
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>
                {d.slip ? (
                  <span className="rc-slip">
                    <Paperclip size={11} aria-hidden="true" /> สลิป
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
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
              >
                {fmtSigned(d.cumDrift)}
              </td>
            </tr>
          ))}
        </tbody>
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
              <div className="rc-period-label">เงินสด+เหรียญ</div>
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
                <a
                  href={`/chairops/reconcile/${branchId}`}
                  className="btn btn-sm btn-ghost"
                >
                  <Eye size={11} aria-hidden="true" /> ดูรายวัน
                </a>
              )}
              {Math.abs(p.diff ?? 0) >= 100 && (p.diff ?? 0) < 0 && branchId && (
                <a
                  href={`/chairops/reconcile/${branchId}#write-off`}
                  className="btn btn-sm"
                >
                  <Minus size={11} aria-hidden="true" /> สร้าง write-off
                </a>
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
