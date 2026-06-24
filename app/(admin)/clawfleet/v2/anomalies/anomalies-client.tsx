"use client";

/**
 * ClawFleet v2 — Anomaly Inbox client island.
 *
 * Ported from the `AnomalyInboxPage` component in `~/ตู้คีบ/ClawFleet Redesign.html`.
 * Renders ONLY the `.cf-page` body — Sidebar + TopBar come from the V2Shell
 * client layout (`components/clawfleet/v2/shell.tsx`).
 *
 * Data (anomalies + branches + branch filter) arrives via props from the server
 * page. Clicking a row opens the shared `AnomalyReview` modal; a decision calls
 * the `reviewV2Session` mutation, shows a `cf-toast`, and cycles to the next
 * pending anomaly.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Ic, Pill, Section, StatTile, fmtTHB } from "@/components/clawfleet/v2/chrome";
import { AnomalyReview } from "@/components/clawfleet/v2/anomaly-review";
import { reviewV2Session } from "@/lib/clawfleet/v2-actions";
import { anomalyBranchLabel, anomalySubLabel } from "@/lib/clawfleet/v2-data";
import type { Anomaly, Branch, BranchFallback } from "@/lib/clawfleet/v2-data";

type ToastKind = "approve" | "recheck" | "escalate";
type ToastState = { kind: ToastKind; text: string };

export function AnomaliesClient({
  branch,
  anomalies,
  branches,
}: {
  branch: string;
  anomalies: Anomaly[];
  branches: Branch[];
}) {
  void branch;

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const getBranch = (id: string): Branch | BranchFallback =>
    branchMap.get(id) ?? { id, name: id, code: id };

  const router = useRouter();
  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "cash_short" | "prize_short">("all");

  // คลิกแถว = เปิดหน้าไส้ในเต็มจอ (drill-in) · ปุ่ม "เริ่มตรวจทีละสาขา" = modal ในหน้า
  const drillTo = (a: Anomaly) => router.push(`/clawfleet/v2/anomalies/${encodeURIComponent(a.id)}`);

  const visible = anomalies.filter((a) => typeFilter === "all" || a.type === typeFilter);
  const totalGap = visible.reduce((s, a) => s + a.gap, 0);
  const totalPrize = visible.reduce((s, a) => s + Math.max(0, a.prizeGap), 0);
  const sorted = [...visible].sort((a, b) => b.gap - a.gap);

  const openAnomaly = (a?: Anomaly) => {
    setReviewing(a ?? sorted[0] ?? anomalies[0] ?? null);
  };

  const nextAnomaly = () => {
    if (!reviewing || sorted.length === 0) return;
    const i = sorted.findIndex((x) => x.id === reviewing.id);
    const next = sorted[(i + 1) % sorted.length];
    setReviewing(next ?? null);
  };

  const decide = async (decision: string, note: string) => {
    const kind = decision as ToastKind;
    const current = reviewing;
    if (current) {
      // Soft-fails on mock rows (no real session). Toast shows regardless.
      await reviewV2Session(current.id, kind, note);
    }
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
    if (!current) return;
    const i = sorted.findIndex((x) => x.id === current.id);
    const remaining = sorted.filter((x) => x.id !== current.id);
    if (remaining.length > 0) {
      setReviewing(remaining[i % remaining.length] ?? remaining[0] ?? null);
    } else {
      setReviewing(null);
    }
  };

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Anomaly inbox</div>
          <h1 className="cf-h1">{visible.length} สาขาที่ระบบ flag</h1>
          <div className="cf-page-sub">
            เงิน/ตุ๊กตา ไม่ตรงกับมิเตอร์เกิน 5% threshold · เริ่มจากสาขาที่หายมากที่สุด
          </div>
        </div>
        <div className="cf-page-actions">
          <button
            className={`cf-btn cf-btn-ghost ${typeFilter !== "all" ? "is-active" : ""}`}
            onClick={() => setShowFilter((v) => !v)}
          >
            <Ic name="filter" size={14} /> ตัวกรอง
            {typeFilter !== "all" && <span className="cf-tab-n">1</span>}
          </button>
          <button className="cf-btn cf-btn-primary" onClick={() => openAnomaly()}>
            เริ่มตรวจทีละสาขา <Ic name="arrowR" size={14} />
          </button>
        </div>
      </div>

      {showFilter && (
        <div className="cf-tabs" style={{ marginBottom: 4 }}>
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

      <div className="cf-insight-cards">
        <StatTile label="P0 ขัดขวาง" value="0" sub="ไม่มีรอบขัดขวาง" tone="neutral" icon="alert" />
        <StatTile label="P1 เตือน" value={visible.length} sub="cross-check ผิด" tone="amber" icon="alert" />
        <StatTile
          label="รวมเงินที่ขาด"
          value={fmtTHB(totalGap)}
          sub={`จาก ${visible.filter((a) => a.gap > 0).length} รอบ`}
          tone="primary"
          icon="trendDown"
        />
        <StatTile
          label="ตุ๊กตาที่หาย"
          value={`${totalPrize} ตัว`}
          sub={`จาก ${visible.filter((a) => a.prizeGap > 0).length} รอบ`}
          tone="neutral"
          icon="package"
        />
      </div>

      <Section title="คิวรอตรวจ" sub="เรียงตามมูลค่าที่หาย">
        <div className="cf-anomaly-list">
          {sorted.map((a) => (
            <AnomalyRow key={a.id} a={a} branch={getBranch(a.branchId)} onOpen={() => drillTo(a)} />
          ))}
          {sorted.length === 0 && (
            <div className="cf-dim" style={{ padding: "20px 4px" }}>
              ไม่มีรายการในตัวกรองนี้
            </div>
          )}
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
function AnomalyRow({
  a,
  branch,
  onOpen,
}: {
  a: Anomaly;
  branch: Branch | BranchFallback;
  onOpen: () => void;
}) {
  const headline = anomalyBranchLabel(a, branch);
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
