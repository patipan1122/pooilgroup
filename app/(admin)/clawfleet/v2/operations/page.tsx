"use client";

/**
 * ClawFleet v2 — Operations page.
 *
 * Ported from `OperationsPage` + `OpsRow` in `~/ตู้คีบ/src/page-rest.jsx`.
 * Renders ONLY the `.cf-page` body — Sidebar + TopBar come from the V2Shell
 * client layout (`components/clawfleet/v2/shell.tsx`).
 *
 * Branch filter is read from the `?branch=` searchParam. Sessions are the merge
 * of ACTIVE_SESSIONS (active/stale) + ANOMALIES (review) + CLOSED_TODAY (closed),
 * exactly as the mockup does. A "review" row's "ตรวจ" button opens the shared
 * `AnomalyReview` modal; a decision shows a `cf-toast`.
 */

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Avatar, Ic, Pill, fmtTHB } from "@/components/clawfleet/v2/chrome";
import { AnomalyReview } from "@/components/clawfleet/v2/anomaly-review";
import {
  ACTIVE_SESSIONS,
  ANOMALIES,
  CLOSED_TODAY,
  getBranch,
  type Anomaly,
  type AnomalySeverity,
} from "@/lib/clawfleet/v2-data";

/* Discriminated union for the merged Operations rows. */
type OpsSession =
  | {
      status: "active" | "stale";
      id: string;
      branchId: string;
      machines: number;
      done: number;
      staff: string;
      staffAvatar: string;
      elapsed: string;
      startedAt: string;
      stale: boolean;
    }
  | {
      status: "review";
      id: string;
      branchId: string;
      machines: number;
      done: number;
      staff: string;
      staffAvatar: string;
      elapsed: string;
      severity: AnomalySeverity;
      revenue: number;
      gap: number;
      prizeGap: number;
      typeLabel: string;
      anomalyRef: Anomaly;
    }
  | {
      status: "closed";
      id: string;
      branchId: string;
      machines: number;
      done: number;
      revenue: number;
      prizeOut: number;
      staff: string;
      staffAvatar: string;
      closedAt: string;
    };

type ToastKind = "approve" | "recheck" | "escalate";
type ToastState = { kind: ToastKind; text: string };

type FilterId = "all" | "active" | "stale" | "review" | "closed";

export default function OperationsPage() {
  const branch = useSearchParams().get("branch") ?? "all";
  const [filter, setFilter] = useState<FilterId>("all");
  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const sessions: OpsSession[] = [
    ...ACTIVE_SESSIONS.map(
      (s): OpsSession => ({ ...s, status: s.stale ? "stale" : "active" }),
    ),
    ...ANOMALIES.map(
      (a): OpsSession => ({
        id: a.id,
        branchId: a.branchId,
        machines: a.machines.length || 6,
        done: a.machines.length || 6,
        staff: a.staff,
        staffAvatar: a.staffAvatar,
        elapsed: a.duration,
        status: "review",
        severity: a.severity,
        revenue: a.actualCash,
        gap: a.gap,
        prizeGap: a.prizeGap,
        typeLabel: a.typeLabel,
        anomalyRef: a,
      }),
    ),
    ...CLOSED_TODAY.map(
      (c): OpsSession => ({ ...c, status: "closed", done: c.machines }),
    ),
  ];

  const filtered = sessions
    .filter((s) => branch === "all" || s.branchId === branch)
    .filter((s) => filter === "all" || s.status === filter);

  const stats = {
    all: sessions.length,
    active: sessions.filter((s) => s.status === "active").length,
    stale: sessions.filter((s) => s.status === "stale").length,
    review: sessions.filter((s) => s.status === "review").length,
    closed: sessions.filter((s) => s.status === "closed").length,
  };

  const tabs: { id: FilterId; name: string; n: number; color?: string }[] = [
    { id: "all", name: "ทั้งหมด", n: stats.all },
    { id: "active", name: "กำลังเดิน", n: stats.active, color: "blue" },
    { id: "stale", name: "ค้าง", n: stats.stale, color: "amber" },
    { id: "review", name: "รอตรวจ", n: stats.review, color: "red" },
    { id: "closed", name: "ปิดแล้ว", n: stats.closed, color: "emerald" },
  ];

  const openAnomaly = (a: Anomaly) => setReviewing(a);

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
    setReviewing(null);
  };

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">ปฏิบัติการ</div>
          <h1 className="cf-h1">รอบเก็บเงิน · วันนี้</h1>
          <div className="cf-page-sub">
            {sessions.length} รอบจาก 10 สาขา — กำลังเดิน {stats.active} · รอตรวจ {stats.review} · ปิดแล้ว {stats.closed}
          </div>
        </div>
        <div className="cf-page-actions">
          <button className="cf-btn cf-btn-ghost">
            <Ic name="download" size={14} /> CSV
          </button>
          <button className="cf-btn cf-btn-primary">
            <Ic name="plus" size={14} /> เริ่มรอบใหม่
          </button>
        </div>
      </div>

      <div className="cf-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`cf-tab ${filter === t.id ? "is-active" : ""}`}
            onClick={() => setFilter(t.id)}
          >
            {t.color && <span className={`cf-tab-dot cf-tab-dot-${t.color}`} />}
            <span>{t.name}</span>
            <span className="cf-tab-n">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="cf-ops-table">
        <div className="cf-ops-headrow">
          <span>สถานะ</span>
          <span>สาขา</span>
          <span>พนักงาน</span>
          <span>ความคืบหน้า</span>
          <span>เวลา</span>
          <span className="cf-ops-headrow-r">รายได้/Gap</span>
          <span></span>
        </div>
        {filtered.map((s) => (
          <OpsRow key={s.id + s.status} s={s} onOpenAnomaly={openAnomaly} />
        ))}
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
    </div>
  );
}

function OpsRow({ s, onOpenAnomaly }: { s: OpsSession; onOpenAnomaly: (a: Anomaly) => void }) {
  const info = getBranch(s.branchId);
  const pct = s.machines ? Math.round((s.done / s.machines) * 100) : 0;
  return (
    <div className={`cf-ops-row cf-ops-row-${s.status}`}>
      <div className="cf-ops-status">
        {s.status === "active" && (
          <Pill color="blue" dot size="sm">
            กำลังเดิน
          </Pill>
        )}
        {s.status === "stale" && (
          <Pill color="amber" dot size="sm">
            ค้าง
          </Pill>
        )}
        {s.status === "review" && (
          <Pill color="red" dot size="sm">
            รอตรวจ · {s.severity}
          </Pill>
        )}
        {s.status === "closed" && (
          <Pill color="emerald" dot size="sm">
            ปิดแล้ว
          </Pill>
        )}
      </div>
      <div className="cf-ops-zone">
        <div className="cf-ops-zone-name">{info.name}</div>
        <div className="cf-ops-zone-meta">
          {info.area} · {s.id}
        </div>
      </div>
      <div className="cf-ops-staff">
        <Avatar initials={s.staffAvatar} size="sm" />
        <span>{s.staff}</span>
      </div>
      <div className="cf-ops-progress">
        <div className="cf-progress cf-progress-sm">
          <div
            className={`cf-progress-bar cf-progress-bar-${s.status}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="cf-ops-progress-text">
          {s.done}/{s.machines}
        </span>
      </div>
      <div className="cf-ops-time">
        <Ic name="clock" size={12} />
        <span>{s.status === "closed" ? s.closedAt : s.elapsed}</span>
      </div>
      <div className="cf-ops-rev">
        {s.status === "review" && (
          <div>
            {s.gap > 0 && (
              <div className="cf-text-red">
                <strong>-{fmtTHB(s.gap)}</strong>
              </div>
            )}
            {s.prizeGap > 0 && s.gap === 0 && (
              <div className="cf-text-amber">
                <strong>-{s.prizeGap} ตัว</strong>
              </div>
            )}
            <div className="cf-dim">{s.typeLabel}</div>
          </div>
        )}
        {s.status === "closed" && (
          <div>
            <strong>{fmtTHB(s.revenue)}</strong>
            <div className="cf-dim">คีบ {s.prizeOut} ตัว</div>
          </div>
        )}
        {(s.status === "active" || s.status === "stale") && <span className="cf-dim">—</span>}
      </div>
      <div className="cf-ops-cta">
        {s.status === "review" ? (
          <button
            className="cf-btn cf-btn-primary cf-btn-sm"
            onClick={() => onOpenAnomaly(s.anomalyRef)}
          >
            ตรวจ <Ic name="arrowR" size={12} />
          </button>
        ) : (
          <button className="cf-btn cf-btn-ghost cf-btn-sm">
            <Ic name="chevronR" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
