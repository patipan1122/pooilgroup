"use client";

/**
 * ClawFleet v2 — Anomaly Inbox page.
 *
 * Ported from the `AnomalyInboxPage` component in `~/ตู้คีบ/ClawFleet Redesign.html`.
 * Renders ONLY the `.cf-page` body — Sidebar + TopBar come from the V2Shell
 * client layout (`components/clawfleet/v2/shell.tsx`).
 *
 * Branch filter is read from the `?branch=` searchParam. Clicking a row opens
 * the shared `AnomalyReview` modal; a decision shows a `cf-toast` and cycles to
 * the next pending anomaly.
 */

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Avatar, Ic, Pill, Section, StatTile, fmtTHB } from "@/components/clawfleet/v2/chrome";
import { AnomalyReview } from "@/components/clawfleet/v2/anomaly-review";
import { ANOMALIES, getBranch, type Anomaly } from "@/lib/clawfleet/v2-data";

type ToastKind = "approve" | "recheck" | "escalate";
type ToastState = { kind: ToastKind; text: string };

export default function AnomalyInboxPage() {
  const branch = useSearchParams().get("branch") ?? "all";

  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const anomalies = ANOMALIES.filter((a) => branch === "all" || a.branchId === branch);
  const totalGap = anomalies.reduce((s, a) => s + a.gap, 0);
  const totalPrize = anomalies.reduce((s, a) => s + Math.max(0, a.prizeGap), 0);
  const sorted = [...anomalies].sort((a, b) => b.gap - a.gap);

  const openAnomaly = (a?: Anomaly) => {
    setReviewing(a ?? sorted[0] ?? ANOMALIES[0] ?? null);
  };

  const nextAnomaly = () => {
    if (!reviewing) return;
    const i = ANOMALIES.findIndex((x) => x.id === reviewing.id);
    const next = ANOMALIES[(i + 1) % ANOMALIES.length];
    setReviewing(next);
  };

  const decide = (decision: string, note: string) => {
    const kind = decision as ToastKind;
    // TODO[v2-wire-db]: persist `note` to the audit log alongside the decision.
    void note;
    setToast({
      kind,
      text:
        kind === "approve"
          ? "อนุมัติแล้ว · เข้ารายงาน"
          : kind === "recheck"
            ? "แจ้งให้พนักงานตรวจซ้ำ · LINE ส่งแล้ว"
            : "ส่งให้ผู้จัดการ · รออนุมัติ",
    });
    setTimeout(() => setToast(null), 2400);
    // move to next anomaly if any
    if (!reviewing) return;
    const i = ANOMALIES.findIndex((x) => x.id === reviewing.id);
    const remaining = ANOMALIES.filter((x) => x.id !== reviewing.id);
    if (remaining.length > 0) {
      setReviewing(remaining[i % remaining.length] ?? remaining[0]);
    } else {
      setReviewing(null);
    }
  };

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Anomaly inbox</div>
          <h1 className="cf-h1">{anomalies.length} สาขาที่ระบบ flag</h1>
          <div className="cf-page-sub">
            เงิน/ตุ๊กตา ไม่ตรงกับมิเตอร์เกิน 5% threshold · เริ่มจากสาขาที่หายมากที่สุด
          </div>
        </div>
        <div className="cf-page-actions">
          <button className="cf-btn cf-btn-ghost">
            <Ic name="filter" size={14} /> ตัวกรอง
          </button>
          <button className="cf-btn cf-btn-primary" onClick={() => openAnomaly()}>
            เริ่มตรวจทีละสาขา <Ic name="arrowR" size={14} />
          </button>
        </div>
      </div>

      <div className="cf-insight-cards">
        <StatTile label="P0 ขัดขวาง" value="0" sub="ไม่มีรอบขัดขวาง" tone="neutral" icon="alert" />
        <StatTile label="P1 เตือน" value={anomalies.length} sub="cross-check ผิด" tone="amber" icon="alert" />
        <StatTile
          label="รวมเงินที่ขาด"
          value={fmtTHB(totalGap)}
          sub={`จาก ${anomalies.filter((a) => a.gap > 0).length} รอบ`}
          tone="primary"
          icon="trendDown"
        />
        <StatTile
          label="ตุ๊กตาที่หาย"
          value={`${totalPrize} ตัว`}
          sub={`จาก ${anomalies.filter((a) => a.prizeGap > 0).length} รอบ`}
          tone="neutral"
          icon="package"
        />
      </div>

      <Section title="คิวรอตรวจ" sub="เรียงตามมูลค่าที่หาย">
        <div className="cf-anomaly-list">
          {sorted.map((a) => (
            <AnomalyRow key={a.id} a={a} onOpen={() => openAnomaly(a)} />
          ))}
        </div>
      </Section>

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
    </div>
  );
}

/* Local copy of the hub's AnomalyRow (hub agent owns the canonical one). */
function AnomalyRow({ a, onOpen }: { a: Anomaly; onOpen: () => void }) {
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
          {a.gap === 0 && a.prizeGap > 0 && "ตุ๊กตาหาย"}
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
