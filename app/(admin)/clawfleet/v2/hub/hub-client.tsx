"use client";

/**
 * ClawFleet v2 — Hub client = แดชบอร์ดกำไร/ขาดทุน.
 *
 * โครงบนลงล่าง:
 *   1. Hero — ยอดขายรวมวันนี้ + กำไรรวม(เขียว)/ขาดทุน(แดง) + จำนวนรอบ + ค่าเฉลี่ยบาท/ตัว
 *   2. "ตอนนี้ต้องทำ" — Anomaly CTA + รอบกำลังเก็บ(OPEN) + รอตรวจ
 *   3. อันดับสาขา — เรียงแย่→ดี · ค่าเฉลี่ยบาท/ตัว(เด่น) + ธงสี + กำไร/ขาดทุน · คลิกลึกเข้าสาขา
 *   4. Anomaly inbox (ของเดิม · โชว์ชื่อ)
 *
 * คงลุคเดิม: แถบน้ำเงิน ตัวขาว · ใช้ class .cf-* เดิมทั้งหมด ไม่ฮาร์ดโค้ดสี.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ic, Pill, Section } from "@/components/clawfleet/v2/chrome";
import { AnomalyReview } from "@/components/clawfleet/v2/anomaly-review";
import { reviewV2Session } from "@/lib/clawfleet/v2-actions";
import { anomalyBranchLabel, anomalySubLabel } from "@/lib/clawfleet/v2-data";
import type { Anomaly } from "@/lib/clawfleet/v2-data";
import type { BranchPnl, PnlSummary, PnlFlagInfo } from "@/lib/clawfleet/pnl-queries";

/* toast decision kinds + copy (mirrors the mockup App.decide) */
type ToastKind = "approve" | "recheck" | "escalate";
type Toast = { kind: ToastKind; text: string };

const TOAST_TEXT: Record<ToastKind, string> = {
  approve: "อนุมัติแล้ว · เข้ารายงาน",
  recheck: "แจ้งให้พนักงานตรวจซ้ำ · LINE ส่งแล้ว",
  escalate: "ส่งให้ผู้จัดการ · รออนุมัติ",
};

function baht(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export function HubClient({
  branch,
  branchPnl,
  summary,
  hub,
  anomalies: anomaliesProp,
}: {
  branch: string;
  branchPnl: BranchPnl[];
  summary: PnlSummary;
  hub: {
    activeSessions: { id: string; branchId: string; stale: boolean; staff: string; elapsed: string }[];
    closedToday: unknown[];
  };
  anomalies: Anomaly[];
}) {
  const router = useRouter();

  const branchNameMap = useMemo(
    () => new Map(branchPnl.map((b) => [b.branchId, b.name])),
    [branchPnl],
  );
  const getBranchName = (id: string): string => branchNameMap.get(id) ?? id;

  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "cash_short" | "prize_short">("all");

  const anomalies = anomaliesProp;
  const openSessions = hub.activeSessions;
  const reviewWaiting = anomalies.length;

  const totalGap = anomalies.reduce((s, a) => s + a.gap, 0);

  const anomaliesSorted = useMemo(
    () => [...anomalies].sort((a, b) => b.gap - a.gap),
    [anomalies],
  );
  const inboxList = useMemo(
    () => anomaliesSorted.filter((a) => typeFilter === "all" || a.type === typeFilter),
    [anomaliesSorted, typeFilter],
  );

  const openAnomaly = (a?: Anomaly) => setReviewing(a ?? anomaliesSorted[0] ?? null);
  const nextAnomaly = () => {
    if (!reviewing || anomaliesSorted.length === 0) return;
    const i = anomaliesSorted.findIndex((x) => x.id === reviewing.id);
    setReviewing(anomaliesSorted[(i + 1) % anomaliesSorted.length] ?? null);
  };
  const decide = (decision: string, note: string) => {
    const kind = (decision as ToastKind) in TOAST_TEXT ? (decision as ToastKind) : "approve";
    const target = reviewing;
    if (target) void reviewV2Session(target.id, kind, note);
    setToast({ kind, text: TOAST_TEXT[kind] });
    setTimeout(() => setToast(null), 2400);
    if (!target) return;
    const i = anomaliesSorted.findIndex((x) => x.id === target.id);
    const remaining = anomaliesSorted.filter((x) => x.id !== target.id);
    setReviewing(remaining.length > 0 ? (remaining[i % remaining.length] ?? remaining[0] ?? null) : null);
  };

  const goBranch = (id: string) => router.push(`/clawfleet/v2/hub/${id}`);

  const profitPositive = summary.profit >= 0;

  return (
    <>
      <div className="cf-page">
        {/* Greeting */}
        <div className="cf-greeting">
          <div>
            <div className="cf-eyebrow">แดชบอร์ดกำไร/ขาดทุน · วันนี้</div>
            <h1 className="cf-h1">
              วันนี้ <span className="cf-h1-em">{profitPositive ? "กำไร" : "ขาดทุน"}</span> เท่าไหร่?
            </h1>
          </div>
          <div className="cf-greeting-right">
            <div className="cf-status-pulse">
              <span className="cf-pulse-dot" />
              <span>ระบบทำงานปกติ</span>
              <span className="cf-dim">·</span>
              <span className="cf-dim">{branchPnl.length} สาขา</span>
            </div>
          </div>
        </div>

        {/* HERO — ยอดขาย + กำไร/ขาดทุน + ค่าเฉลี่ยบาท/ตัว */}
        <div className="cf-hero is-split">
          <div className="cf-hero-revenue">
            <div className="cf-hero-label">
              ยอดขายรวมวันนี้ · {summary.sessions} รอบ จาก {branchPnl.length} สาขา
            </div>
            <div className="cf-hero-amount">
              <span className="cf-hero-currency">฿</span>
              <span className="cf-hero-num">{baht(summary.revenue)}</span>
            </div>
            <div className="cf-hero-meta">
              {summary.hasCost ? (
                <Pill color={profitPositive ? "emerald" : "red"} size="sm" dot>
                  {profitPositive ? "กำไร" : "ขาดทุน"} ฿{baht(Math.abs(summary.profit))}
                </Pill>
              ) : (
                <Pill color="slate" size="sm">
                  ยังไม่ตั้งต้นทุนตุ๊กตา
                </Pill>
              )}
              <span className="cf-dim">
                ตุ๊กตาออก {baht(summary.dollsOut)} ตัว
                {summary.avgBahtPerDoll != null && (
                  <> · เฉลี่ย ฿{baht(summary.avgBahtPerDoll)}/ตัว</>
                )}
              </span>
            </div>
            {summary.avgBahtPerDoll != null && (
              <div className="cf-hero-avg">
                <div className="cf-hero-avg-num">฿{baht(summary.avgBahtPerDoll)}</div>
                <div className="cf-hero-avg-lbl">ค่าเฉลี่ยบาท / ตุ๊กตา 1 ตัว (รวมทุกสาขา)</div>
              </div>
            )}
          </div>

          <div className="cf-hero-action">
            <div className="cf-hero-action-label">
              <Ic name="zap" size={14} />
              <span>ตอนนี้ต้องทำ</span>
              <span className="cf-hero-count">{reviewWaiting + summary.riskyBranches}</span>
            </div>
            <button className="cf-hero-cta" onClick={() => openAnomaly(anomaliesSorted[0])}>
              <div className="cf-hero-cta-main">
                <div className="cf-hero-cta-title">ตรวจ Anomaly · {anomalies.length} รายการ</div>
                <div className="cf-hero-cta-sub">
                  เงิน/ตุ๊กตา ไม่ตรงรวม ฿{baht(totalGap)} · ใช้เวลา ~{anomalies.length * 3} นาที
                </div>
              </div>
              <Ic name="arrowR" size={20} />
            </button>
            <div className="cf-hero-quick">
              <button className="cf-quick-btn" onClick={() => router.push("/clawfleet/v2/operations")}>
                <Ic name="play" size={14} />
                <span>🟢 {openSessions.length} รอบกำลังเก็บ</span>
              </button>
              <button className="cf-quick-btn" onClick={() => router.push("/clawfleet/v2/anomalies")}>
                <Ic name="clock" size={14} />
                <span>⏳ {reviewWaiting} รอบรอตรวจ</span>
              </button>
            </div>
          </div>
        </div>

        {/* อันดับสาขา — เรียงแย่→ดี · คลิกลึกเข้าสาขา */}
        <Section
          title="อันดับสาขา · เรียงจากน่าห่วง → ดี"
          sub={`ค่าเฉลี่ยบาท/ตัว เด่น = ตัวชี้กำไร · ${summary.riskyBranches} สาขามีตู้เสี่ยงขาดทุน · กดเข้าสาขาเพื่อดูรายตู้`}
          action={
            <div className="cf-pnl-legend">
              <span className="cf-pnl-legend-item"><i className="cf-dot cf-dot-emerald" />พอดี 180–280</span>
              <span className="cf-pnl-legend-item"><i className="cf-dot cf-dot-amber" />ตึง 280–350</span>
              <span className="cf-pnl-legend-item"><i className="cf-dot cf-dot-red" />เสี่ยง</span>
            </div>
          }
        >
          <div className="cf-branch-list">
            {branchPnl.map((b) => (
              <BranchPnlRow key={b.branchId} b={b} onClick={() => goBranch(b.branchId)} />
            ))}
            {branchPnl.length === 0 && (
              <div className="cf-dim" style={{ padding: "16px 4px" }}>
                ยังไม่มีสาขาตู้คีบ · กด &quot;ใส่ข้อมูลตัวอย่าง&quot; ที่หน้าจัดการเพื่อทดลอง
              </div>
            )}
          </div>
        </Section>

        {/* Anomaly inbox (เดิม · โชว์ชื่อสาขา/ตู้/พนักงาน) */}
        <Section
          title="Anomaly inbox"
          sub={`${anomalies.length} รายการที่ระบบ flag · จัดเรียงตามมูลค่าที่หาย`}
          action={
            <div className="cf-section-actions">
              <button
                className={`cf-btn cf-btn-ghost ${typeFilter !== "all" ? "is-active" : ""}`}
                onClick={() => setShowFilter((v) => !v)}
              >
                <Ic name="filter" size={14} />
                ตัวกรอง
                {typeFilter !== "all" && <span className="cf-tab-n">1</span>}
              </button>
              <button
                className="cf-btn cf-btn-primary"
                onClick={() => openAnomaly(inboxList[0] ?? anomaliesSorted[0])}
                disabled={anomalies.length === 0}
              >
                เริ่มตรวจทีละรายการ <Ic name="arrowR" size={14} />
              </button>
            </div>
          }
        >
          {showFilter && (
            <div className="cf-tabs" style={{ marginBottom: 8 }}>
              {(
                [
                  { id: "all", name: "ทั้งหมด", n: anomalies.length },
                  { id: "cash_short", name: "เงินขาด", n: anomalies.filter((a) => a.type === "cash_short").length, color: "red" },
                  { id: "prize_short", name: "ตุ๊กตาหาย", n: anomalies.filter((a) => a.type === "prize_short").length, color: "amber" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  className={`cf-tab ${typeFilter === t.id ? "is-active" : ""}`}
                  onClick={() => setTypeFilter(t.id)}
                >
                  {"color" in t && t.color && <span className={`cf-tab-dot cf-tab-dot-${t.color}`} />}
                  <span>{t.name}</span>
                  <span className="cf-tab-n">{t.n}</span>
                </button>
              ))}
            </div>
          )}
          <div className="cf-anomaly-list">
            {inboxList.map((a) => (
              <AnomalyRow key={a.id} a={a} onOpen={() => openAnomaly(a)} branchName={getBranchName(a.branchId)} />
            ))}
            {inboxList.length === 0 && (
              <div className="cf-dim" style={{ padding: "16px 4px" }}>
                ไม่มีรายการที่ต้องตรวจ · ทุกอย่างปกติ
              </div>
            )}
          </div>
        </Section>
      </div>

      {reviewing && (
        <AnomalyReview
          anomaly={reviewing}
          onClose={() => setReviewing(null)}
          onNext={nextAnomaly}
          onDecision={decide}
        />
      )}

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
/* Sub-components                                               */
/* ============================================================ */

/** ธงสี — ใช้ Pill ตามสีของ flag */
function FlagPill({ flag }: { flag: PnlFlagInfo }) {
  return (
    <Pill color={flag.tone} size="sm" dot={flag.flag !== "NODATA"}>
      {flag.label}
    </Pill>
  );
}

/** แถวสาขา — ค่าเฉลี่ยบาท/ตัว เด่น + กำไร/ขาดทุน + ธง · คลิกลึกเข้าสาขา */
function BranchPnlRow({ b, onClick }: { b: BranchPnl; onClick: () => void }) {
  const profitPositive = b.profit >= 0;
  return (
    <button className="cf-branch-row cf-pnl-row" onClick={onClick}>
      <div className="cf-branch-left">
        <div className={`cf-pnl-avg cf-pnl-avg-${b.flag.tone}`}>
          {b.avgBahtPerDoll != null ? (
            <>
              <span className="cf-pnl-avg-num">฿{baht(b.avgBahtPerDoll)}</span>
              <span className="cf-pnl-avg-unit">/ตัว</span>
            </>
          ) : (
            <span className="cf-pnl-avg-na">—</span>
          )}
        </div>
        <div>
          <div className="cf-branch-name">{b.name}</div>
          <div className="cf-branch-meta">
            <FlagPill flag={b.flag} />
            <span className="cf-dim">·</span>
            <span>{b.area}</span>
            {b.riskyMachines > 0 && (
              <>
                <span className="cf-dim">·</span>
                <span className="cf-text-red">🔴 ตู้เสี่ยง {b.riskyMachines} ตู้</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="cf-branch-right">
        <div className="cf-branch-rev">฿{baht(b.revenue)}</div>
        {b.hasCost ? (
          <div className={`cf-pnl-profit ${profitPositive ? "is-up" : "is-down"}`}>
            {profitPositive ? "กำไร" : "ขาดทุน"} ฿{baht(Math.abs(b.profit))}
          </div>
        ) : (
          <div className="cf-dim cf-pnl-profit">ยังไม่ตั้งต้นทุน</div>
        )}
        <div className="cf-dim cf-pnl-sub">ตุ๊กตา {baht(b.dollsOut)} ตัว · {b.sessions} รอบ</div>
      </div>
      <Ic name="chevronR" size={18} />
    </button>
  );
}

function AnomalyRow({
  a,
  onOpen,
  branchName,
}: {
  a: Anomaly;
  onOpen: () => void;
  branchName: string;
}) {
  const headline = anomalyBranchLabel(a, { id: a.branchId, name: branchName, code: a.branchCode ?? branchName });
  const sub = anomalySubLabel(a);
  return (
    <button className="cf-anom-row" onClick={onOpen}>
      <div className="cf-anom-sev">
        <span className={`cf-sev cf-sev-${a.severity.toLowerCase()}`}>{a.severity}</span>
      </div>
      <div className="cf-anom-body">
        <div className="cf-anom-head">
          <span className="cf-anom-zone">{headline}</span>
          <Pill color={a.type === "cash_short" ? "red" : "amber"} size="sm">
            {a.typeLabel}
          </Pill>
          <span className="cf-anom-id">{a.id}</span>
        </div>
        <div className="cf-anom-reason">{sub}</div>
      </div>
      <div className="cf-anom-gap">
        {a.gap > 0 && <div className="cf-anom-gap-amt">-฿{a.gap.toLocaleString("th-TH")}</div>}
        {a.prizeGap > 0 && a.gap === 0 && <div className="cf-anom-gap-amt">-{a.prizeGap} ตัว</div>}
        <div className="cf-anom-gap-pct">
          {a.gap > 0 && `${a.gapPct.toFixed(1)}% ห่าง`}
          {a.gap === 0 && a.prizeGap > 0 && `ตุ๊กตาหาย`}
        </div>
      </div>
      <div className="cf-anom-cta">
        <Ic name="chevronR" size={18} />
      </div>
    </button>
  );
}
