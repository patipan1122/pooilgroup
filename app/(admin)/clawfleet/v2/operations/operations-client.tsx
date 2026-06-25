"use client";

/**
 * ClawFleet v2 — Operations client island.
 *
 * Ported from `OperationsPage` + `OpsRow` in `~/ตู้คีบ/src/page-rest.jsx`.
 * Renders ONLY the `.cf-page` body — Sidebar + TopBar come from the V2Shell
 * client layout (`components/clawfleet/v2/shell.tsx`).
 *
 * Data (active sessions + closed sessions + branches + branch filter) arrives
 * via props from the server page. Sessions are the merge of activeSessions
 * (active/stale) + closedToday (closed) — session lifecycle ONLY. Anomaly
 * review is no longer surfaced here: it lives solely on the dedicated
 * Anomalies page, so Operations carries no review tab / no inline review modal.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Ic, Pill, fmtTHB } from "@/components/clawfleet/v2/chrome";
import type {
  ActiveSession,
  Branch,
  BranchFallback,
  ClosedSession,
} from "@/lib/clawfleet/v2-data";

/* Discriminated union for the merged Operations rows (lifecycle only). */
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

type FilterId = "all" | "active" | "stale" | "closed";

export function OperationsClient({
  branch,
  activeSessions,
  closedToday,
  branches,
}: {
  branch: string;
  activeSessions: ActiveSession[];
  closedToday: ClosedSession[];
  branches: Branch[];
}) {
  void branch;

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const getBranch = (id: string): Branch | BranchFallback =>
    branchMap.get(id) ?? { id, name: id, code: id };

  const [filter, setFilter] = useState<FilterId>("all");
  const router = useRouter();

  const sessions: OpsSession[] = [
    ...activeSessions.map(
      (s): OpsSession => ({ ...s, status: s.stale ? "stale" : "active" }),
    ),
    ...closedToday.map(
      (c): OpsSession => ({ ...c, status: "closed", done: c.machines }),
    ),
  ];

  const filtered = sessions.filter((s) => filter === "all" || s.status === filter);

  function exportCsv() {
    const header = ["รอบ", "สาขา", "พนักงาน", "สถานะ", "ความคืบหน้า", "รายได้/ขาด"];
    const rows = filtered.map((s) => {
      const info = getBranch(s.branchId);
      const money = s.status === "closed" ? `${s.revenue ?? 0}` : "";
      return [s.id, info.name, s.staff, s.status, `${s.done}/${s.machines}`, money];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clawfleet-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stats = {
    all: sessions.length,
    active: sessions.filter((s) => s.status === "active").length,
    stale: sessions.filter((s) => s.status === "stale").length,
    closed: sessions.filter((s) => s.status === "closed").length,
  };

  const tabs: { id: FilterId; name: string; n: number; color?: string }[] = [
    { id: "all", name: "ทั้งหมด", n: stats.all },
    { id: "active", name: "กำลังเดิน", n: stats.active, color: "blue" },
    { id: "stale", name: "ค้าง", n: stats.stale, color: "amber" },
    { id: "closed", name: "ปิดแล้ว", n: stats.closed, color: "emerald" },
  ];

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">ปฏิบัติการ</div>
          <h1 className="cf-h1">รอบเก็บเงิน · วันนี้</h1>
          <div className="cf-page-sub">
            {sessions.length} รอบจาก 10 สาขา — กำลังเดิน {stats.active} · ค้าง {stats.stale} · ปิดแล้ว {stats.closed}
          </div>
        </div>
        <div className="cf-page-actions">
          <button className="cf-btn cf-btn-ghost" onClick={exportCsv}>
            <Ic name="download" size={14} /> CSV
          </button>
          <button className="cf-btn cf-btn-primary" onClick={() => router.push("/clawfleet/v2/collect")}>
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
          <OpsRow
            key={s.id + s.status}
            s={s}
            branch={getBranch(s.branchId)}
            onDrill={(sessionId) => router.push(`/clawfleet/v2/operations/${encodeURIComponent(sessionId)}`)}
          />
        ))}
      </div>
    </div>
  );
}

function OpsRow({
  s,
  branch,
  onDrill,
}: {
  s: OpsSession;
  branch: Branch | BranchFallback;
  onDrill: (sessionId: string) => void;
}) {
  const info = branch;
  const pct = s.machines ? Math.round((s.done / s.machines) * 100) : 0;
  // หัวแถว = ชื่อสาขา เสมอ (ไม่โชว์ UUID)
  const zoneName =
    info.name && info.name !== info.id
      ? info.name
      : (info.code && info.code !== info.id ? info.code : "—");
  const zoneArea = info.area && info.area !== info.id ? info.area : "";
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
        {s.status === "closed" && (
          <Pill color="emerald" dot size="sm">
            ปิดแล้ว
          </Pill>
        )}
      </div>
      <div className="cf-ops-zone">
        <div className="cf-ops-zone-name">{zoneName}</div>
        <div className="cf-ops-zone-meta">
          {zoneArea && <>{zoneArea} · </>}
          <span className="cf-anom-id">{s.id}</span>
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
        {s.status === "closed" && (
          <div>
            <strong>{fmtTHB(s.revenue)}</strong>
            <div className="cf-dim">คีบ {s.prizeOut} ตัว</div>
          </div>
        )}
        {(s.status === "active" || s.status === "stale") && <span className="cf-dim">—</span>}
      </div>
      <div className="cf-ops-cta">
        <button
          className="cf-btn cf-btn-ghost cf-btn-sm"
          onClick={() => onDrill(s.id)}
          title="ดูไส้ในรอบนี้ (รายตู้ · มิเตอร์ · เงิน · รูป)"
        >
          ดูไส้ใน <Ic name="chevronR" size={14} />
        </button>
      </div>
    </div>
  );
}
