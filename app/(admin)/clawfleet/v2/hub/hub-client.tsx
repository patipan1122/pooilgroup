"use client";

/**
 * ClawFleet v2 — Hub client island.
 *
 * Receives all data as props from the `HubPage` server component (real-DB via
 * `lib/clawfleet/v2-loaders`, with graceful mock fallback). Renders the inner
 * `.cf-page` content ported from `~/ตู้คีบ/src/page-hub.jsx` and keeps every bit
 * of interactivity: anomaly review modal, toast, sparkline, router nav.
 *
 * Wiring substitutions vs. the mockup props:
 *   - `branch`        → passed as a prop (derived from `?branch=` on the server)
 *   - `onNav(id)`     → router.push("/clawfleet/v2/" + segMap[id])
 *   - `onOpenAnomaly` → opens the shared AnomalyReview modal via local state
 *   - `onDecision`    → calls the `reviewV2Session` server action (soft-fails on
 *                       mock rows; the toast shows regardless)
 *   - `t` (tweaks)    → defaults only: heroVariant='split', showSparkline=true
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ic,
  Pill,
  Avatar,
  Section,
} from "@/components/clawfleet/v2/chrome";
import { AnomalyReview } from "@/components/clawfleet/v2/anomaly-review";
import { reviewV2Session } from "@/lib/clawfleet/v2-actions";
// TODO[v2-wire-db]: stock-low needs a loader; keep the mock for this one section.
import { BRANCH_STOCK } from "@/lib/clawfleet/v2-data";
import type {
  Anomaly,
  ActiveSession,
  ClosedSession,
  StockEntry,
  TodaySummary,
  TrendDay,
  BranchPerf,
  Branch,
} from "@/lib/clawfleet/v2-data";

/* nav id (mockup sidebar short id) → App Router segment */
const SEG_MAP: Record<string, string> = {
  ops: "operations",
  stock: "stock",
  insights: "insights",
};

/* a stock row carries its owning branch id alongside the entry */
type StockLow = StockEntry & { branchId: string };

/* toast decision kinds + copy (mirrors the mockup App.decide) */
type ToastKind = "approve" | "recheck" | "escalate";
type Toast = { kind: ToastKind; text: string };

const TOAST_TEXT: Record<ToastKind, string> = {
  approve: "อนุมัติแล้ว · เข้ารายงาน",
  recheck: "แจ้งให้พนักงานตรวจซ้ำ · LINE ส่งแล้ว",
  escalate: "ส่งให้ผู้จัดการ · รออนุมัติ",
};

/** branch filter predicate ("all" matches everything) */
function inScope(branch: string, b: string): boolean {
  return branch === "all" || b === branch;
}

export type HubData = {
  today: TodaySummary;
  trend7d: TrendDay[];
  branchPerf: BranchPerf[];
  activeSessions: ActiveSession[];
  closedToday: ClosedSession[];
};

export function HubClient({
  branch,
  hub,
  anomalies: anomaliesProp,
  branches,
}: {
  branch: string;
  hub: HubData;
  anomalies: Anomaly[];
  branches: Branch[];
}) {
  const router = useRouter();

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const getBranch = (id: string): Branch =>
    branchMap.get(id) ?? ({ id, name: id, code: id } as Branch);

  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // tweak defaults (no live Tweaks panel in the ported app)
  const heroVariant = "split";
  const showSparkline = true;

  const anomalies = anomaliesProp;
  const sessions = hub.activeSessions;
  const stale = sessions.filter((s) => s.stale);

  const stockLow = useMemo(() => {
    const out: StockLow[] = [];
    Object.entries(BRANCH_STOCK).forEach(([bid, items]) => {
      if (!inScope(branch, bid)) return;
      items.forEach((s) => {
        const total = s.warehouse + s.inMachines;
        if (s.warehouse <= 4 || total <= 20) out.push({ ...s, branchId: bid });
      });
    });
    return out;
  }, [branch]);

  const totalAttention = anomalies.length + stale.length + stockLow.length;
  const totalGap = anomalies.reduce((s, a) => s + a.gap, 0);

  // anomalies sorted by money lost (ported list ordering)
  const anomaliesSorted = useMemo(
    () => [...anomalies].sort((a, b) => b.gap - a.gap),
    [anomalies],
  );

  /* ---- modal wiring (mirrors mockup App.openAnomaly / nextAnomaly / decide) ---- */
  const openAnomaly = (a?: Anomaly) => {
    const target = a ?? anomaliesSorted[0] ?? null;
    setReviewing(target);
  };

  const nextAnomaly = () => {
    if (!reviewing || anomaliesSorted.length === 0) return;
    const i = anomaliesSorted.findIndex((x) => x.id === reviewing.id);
    const next = anomaliesSorted[(i + 1) % anomaliesSorted.length];
    setReviewing(next);
  };

  const decide = (decision: string, note: string) => {
    const kind = (decision as ToastKind) in TOAST_TEXT ? (decision as ToastKind) : "approve";
    const target = reviewing;
    // persist the decision (soft-fails on mock rows; toast shows regardless)
    if (target) {
      void reviewV2Session(target.id, kind, note);
    }
    setToast({ kind, text: TOAST_TEXT[kind] });
    setTimeout(() => setToast(null), 2400);
    // advance to the next anomaly that isn't the one just decided, else close
    if (!target) return;
    const i = anomaliesSorted.findIndex((x) => x.id === target.id);
    const remaining = anomaliesSorted.filter((x) => x.id !== target.id);
    if (remaining.length > 0) {
      setReviewing(remaining[i % remaining.length] ?? remaining[0]);
    } else {
      setReviewing(null);
    }
  };

  const onNav = (id: string) => {
    const seg = SEG_MAP[id] ?? id;
    const q = branch !== "all" ? `?branch=${branch}` : "";
    router.push(`/clawfleet/v2/${seg}${q}`);
  };

  return (
    <>
      <div className="cf-page">
        {/* Greeting */}
        <div className="cf-greeting">
          <div>
            <div className="cf-eyebrow">วันพุธ · 27 พฤษภาคม 2026 · 21:36 น.</div>
            <h1 className="cf-h1">
              สวัสดีตอนค่ำ <span className="cf-h1-em">patipan</span>
            </h1>
          </div>
          <div className="cf-greeting-right">
            <div className="cf-status-pulse">
              <span className="cf-pulse-dot" />
              <span>ระบบทำงานปกติ</span>
              <span className="cf-dim">·</span>
              <span className="cf-dim">10 สาขา · sync 12 วิที่แล้ว</span>
            </div>
          </div>
        </div>

        {/* HERO */}
        <div className={`cf-hero is-${heroVariant}`}>
          <div className="cf-hero-revenue">
            <div className="cf-hero-label">รายได้วันนี้ · {hub.today.sessions} รอบจาก 10 สาขา</div>
            <div className="cf-hero-amount">
              <span className="cf-hero-currency">฿</span>
              <span className="cf-hero-num">{hub.today.revenue.toLocaleString("th-TH")}</span>
            </div>
            <div className="cf-hero-meta">
              <Pill color="emerald" size="sm" dot>
                +16% จากเมื่อวาน
              </Pill>
              <span className="cf-dim">
                {hub.today.prizesOut} ตุ๊กตาคีบไป · {hub.today.staffActive}/{hub.today.staffTotal} พนง.ออนไลน์
              </span>
            </div>
            {showSparkline && <Sparkline data={hub.trend7d} />}
          </div>

          <div className="cf-hero-action">
            <div className="cf-hero-action-label">
              <Ic name="zap" size={14} />
              <span>ตอนนี้ต้องทำ</span>
              <span className="cf-hero-count">{totalAttention}</span>
            </div>
            <button className="cf-hero-cta" onClick={() => openAnomaly(anomaliesSorted[0])}>
              <div className="cf-hero-cta-main">
                <div className="cf-hero-cta-title">ตรวจ Anomaly · {anomalies.length} สาขา</div>
                <div className="cf-hero-cta-sub">
                  เงิน/ตุ๊กตา ไม่ตรงรวม ฿{totalGap.toLocaleString("th-TH")} · ใช้เวลา ~
                  {anomalies.length * 3} นาที
                </div>
              </div>
              <Ic name="arrowR" size={20} />
            </button>
            <div className="cf-hero-quick">
              <button className="cf-quick-btn" onClick={() => onNav("ops")}>
                <Ic name="clock" size={14} />
                <span>{stale.length} session ค้าง</span>
              </button>
              <button className="cf-quick-btn" onClick={() => onNav("stock")}>
                <Ic name="package" size={14} />
                <span>{stockLow.length} SKU ใกล้หมด</span>
              </button>
            </div>
          </div>
        </div>

        {/* Anomaly inbox */}
        <Section
          title="Anomaly inbox"
          sub={`${anomalies.length} สาขาที่ระบบ flag · จัดเรียงตามมูลค่าที่หาย`}
          action={
            <div className="cf-section-actions">
              <button className="cf-btn cf-btn-ghost">
                <Ic name="filter" size={14} />
                ตัวกรอง
              </button>
              <button
                className="cf-btn cf-btn-primary"
                onClick={() => openAnomaly(anomaliesSorted[0])}
              >
                เริ่มตรวจทีละสาขา <Ic name="arrowR" size={14} />
              </button>
            </div>
          }
        >
          <div className="cf-anomaly-list">
            {anomaliesSorted.map((a) => (
              <AnomalyRow key={a.id} a={a} onOpen={() => openAnomaly(a)} getBranch={getBranch} />
            ))}
          </div>
        </Section>

        {/* Two-column: branches + active sessions */}
        <div className="cf-cols">
          <Section
            title="10 สาขาวันนี้"
            sub="คลิกเพื่อโฟกัสเฉพาะสาขา"
            action={
              <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => onNav("insights")}>
                เปิด Insights →
              </button>
            }
          >
            <div className="cf-branch-list">
              {hub.branchPerf.map((b) => {
                const info = getBranch(b.id);
                return (
                  <button
                    key={b.id}
                    className="cf-branch-row"
                    onClick={() => router.push(`/clawfleet/v2/hub?branch=${b.id}`)}
                  >
                    <div className="cf-branch-left">
                      <div className={`cf-branch-flag cf-branch-flag-${info.tone}`}>
                        {info.avatar}
                      </div>
                      <div>
                        <div className="cf-branch-name">{info.name}</div>
                        <div className="cf-branch-meta">
                          <span>{info.area}</span>
                          <span className="cf-dim">·</span>
                          {b.anomaly > 0 ? (
                            <span className="cf-text-red">⚠ {b.anomaly} anomaly</span>
                          ) : (
                            <span className="cf-text-emerald">ปกติ</span>
                          )}
                          <span className="cf-dim">·</span>
                          <span>{b.prizeOut} ตัวคีบไป</span>
                        </div>
                      </div>
                    </div>
                    <div className="cf-branch-right">
                      <div className="cf-branch-rev">฿{b.revenue.toLocaleString("th-TH")}</div>
                      <div className={`cf-trend cf-trend-${b.change >= 0 ? "up" : "down"}`}>
                        <Ic name={b.change >= 0 ? "trend" : "trendDown"} size={12} />
                        {Math.abs(b.change)}%
                      </div>
                    </div>
                    <BranchBar revenue={b.revenue} max={15000} />
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            title={`รอบที่กำลังเดิน · ${sessions.length}`}
            sub="แตะเพื่อดูรายละเอียดและตู้คีบ"
            action={
              <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => onNav("ops")}>
                ดูทั้งหมด →
              </button>
            }
          >
            <div className="cf-session-list">
              {sessions.slice(0, 4).map((s) => (
                <SessionRow key={s.id} s={s} getBranch={getBranch} />
              ))}
            </div>
          </Section>
        </div>

        {/* Two-column: low stock + closed today */}
        <div className="cf-cols">
          <Section
            title="SKU ใกล้หมด"
            sub="ทั้งคลังสาขาและในตู้"
            action={
              <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => onNav("stock")}>
                เปิด Stock →
              </button>
            }
          >
            <div className="cf-stock-list">
              {stockLow.slice(0, 5).map((s, i) => (
                <StockRow key={s.branchId + s.sku + i} s={s} getBranch={getBranch} />
              ))}
            </div>
          </Section>

          <Section
            title={`รอบที่ปิดแล้ววันนี้ · ${hub.closedToday.length}`}
            sub="ตรวจผ่าน · เข้ารายงานแล้ว"
            action={
              <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => onNav("insights")}>
                เปิด Insights →
              </button>
            }
          >
            <div className="cf-closed-list">
              {hub.closedToday.map((c) => {
                const info = getBranch(c.branchId);
                return (
                  <div key={c.id} className="cf-closed-row">
                    <div className="cf-closed-left">
                      <Pill color="emerald" size="sm" dot>
                        ปิดแล้ว
                      </Pill>
                      <div className="cf-closed-info">
                        <div className="cf-closed-zone">{info.name}</div>
                        <div className="cf-closed-meta">
                          {c.machines} ตู้ · ตุ๊กตาคีบ {c.prizeOut} ตัว · ปิด {c.closedAt}
                        </div>
                      </div>
                    </div>
                    <div className="cf-closed-right">
                      <div className="cf-closed-rev">฿{c.revenue.toLocaleString("th-TH")}</div>
                      <div className="cf-dim">{c.staff}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </div>

      {/* Anomaly review modal (shared component built by parallel agent) */}
      {reviewing && (
        <AnomalyReview
          anomaly={reviewing}
          onClose={() => setReviewing(null)}
          onNext={nextAnomaly}
          onDecision={decide}
        />
      )}

      {/* Toast — non-blocking confirmation (CSS lives in clawfleet-redesign.css) */}
      {toast && (
        <div className={`cf-toast cf-toast-${toast.kind}`}>
          <span className="cf-toast-icon">
            {toast.kind === "approve" ? "✓" : toast.kind === "recheck" ? "↻" : "⚑"}
          </span>
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}

/* ============================================================ */
/* Hub sub-components (ported from page-hub.jsx)                 */
/* ============================================================ */

function AnomalyRow({
  a,
  onOpen,
  getBranch,
}: {
  a: Anomaly;
  onOpen: () => void;
  getBranch: (id: string) => Branch;
}) {
  const branch = getBranch(a.branchId);
  return (
    <button className="cf-anom-row" onClick={onOpen}>
      <div className="cf-anom-sev">
        <span className={`cf-sev cf-sev-${a.severity.toLowerCase()}`}>{a.severity}</span>
      </div>
      <div className="cf-anom-body">
        <div className="cf-anom-head">
          <span className="cf-anom-zone">{branch.name}</span>
          <span className="cf-dim">·</span>
          <span className="cf-anom-branch">{branch.area}</span>
          <Pill color={a.type === "cash_short" ? "red" : "amber"} size="sm">
            {a.typeLabel}
          </Pill>
          <span className="cf-anom-id">{a.id}</span>
        </div>
        <div className="cf-anom-reason">{a.reason}</div>
      </div>
      <div className="cf-anom-gap">
        {a.gap > 0 && <div className="cf-anom-gap-amt">-฿{a.gap.toLocaleString("th-TH")}</div>}
        {a.prizeGap > 0 && a.gap === 0 && <div className="cf-anom-gap-amt">-{a.prizeGap} ตัว</div>}
        <div className="cf-anom-gap-pct">
          {a.gap > 0 && `${a.gapPct.toFixed(1)}% ห่าง`}
          {a.gap === 0 && a.prizeGap > 0 && `ตุ๊กตาหาย`}
        </div>
      </div>
      <div className="cf-anom-meta">
        <Avatar initials={a.staffAvatar} size="sm" />
        <div className="cf-anom-meta-text">
          <div>{a.staff}</div>
          <div className="cf-dim">{a.timeAgo}ที่แล้ว</div>
        </div>
      </div>
      <div className="cf-anom-cta">
        <Ic name="chevronR" size={18} />
      </div>
    </button>
  );
}

function SessionRow({
  s,
  getBranch,
}: {
  s: ActiveSession;
  getBranch: (id: string) => Branch;
}) {
  const info = getBranch(s.branchId);
  const pct = Math.round((s.done / s.machines) * 100);
  return (
    <div className="cf-session-row">
      <div className="cf-session-head">
        <div className="cf-session-left">
          <span className={`cf-status-dot ${s.stale ? "is-stale" : "is-active"}`} />
          <div>
            <div className="cf-session-zone">{info.name}</div>
            <div className="cf-session-meta">
              {info.area} · {s.id}
            </div>
          </div>
        </div>
        <div className="cf-session-right">
          {s.stale && (
            <Pill color="amber" size="sm">
              ค้าง {s.elapsed}
            </Pill>
          )}
          {!s.stale && (
            <Pill color="blue" size="sm">
              เดิน {s.elapsed}
            </Pill>
          )}
        </div>
      </div>
      <div className="cf-session-progress">
        <div className="cf-progress">
          <div className="cf-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="cf-session-progress-text">
          <span>
            {s.done}/{s.machines} ตู้
          </span>
          <span className="cf-dim">{s.staff}</span>
        </div>
      </div>
    </div>
  );
}

function StockRow({
  s,
  getBranch,
}: {
  s: StockLow;
  getBranch: (id: string) => Branch;
}) {
  const branch = getBranch(s.branchId);
  const total = s.warehouse + s.inMachines;
  return (
    <div className="cf-stock-row">
      <div className="cf-stock-meter">
        <div
          className={`cf-stock-badge ${s.warehouse <= 2 ? "is-critical" : s.warehouse <= 6 ? "is-warn" : ""}`}
        >
          {s.warehouse}
        </div>
      </div>
      <div className="cf-stock-body">
        <div className="cf-stock-zone">
          {s.name}
          <span className="cf-stock-code">{s.sku}</span>
        </div>
        <div className="cf-stock-meta">
          {branch.name} · เติมจากคลังกลาง {s.lastDelivery}
        </div>
        <div className="cf-stock-prod">
          คลัง {s.warehouse} · ในตู้ {s.inMachines} · รวม {total} · ใช้ ~{s.velocity}/วัน
        </div>
      </div>
      <div className="cf-stock-cta">
        <button className="cf-btn cf-btn-ghost cf-btn-sm">สั่งเติม</button>
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: TrendDay[] }) {
  const max = Math.max(...data.map((d) => d.revenue));
  const min = Math.min(...data.map((d) => d.revenue));
  const W = 480;
  const H = 64;
  const x = (i: number) => (i / (data.length - 1)) * (W - 12) + 6;
  const y = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 20);
  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.revenue)}`).join(" ");
  const areaPath = linePath + ` L ${x(data.length - 1)} ${H} L ${x(0)} ${H} Z`;
  return (
    <div className="cf-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cf-primary)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--cf-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkGrad)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--cf-primary)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(d.revenue)}
            r={d.today ? 4 : 0}
            fill="var(--cf-primary)"
            stroke="white"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="cf-spark-labels">
        {data.map((d, i) => (
          <span key={i} className={d.today ? "is-today" : ""}>
            {d.day}
          </span>
        ))}
      </div>
    </div>
  );
}

function BranchBar({ revenue, max }: { revenue: number; max: number }) {
  const pct = Math.min(100, (revenue / max) * 100);
  return (
    <div className="cf-branch-bar">
      <div className="cf-branch-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
