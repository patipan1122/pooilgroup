"use client";

/**
 * ClawFleet v2 — Insights client island.
 *
 * Renders the inner `.cf-page` body (4 StatTiles + tab pills + range buttons +
 * dense data table) ported verbatim from the mockup. Data now arrives as props:
 *   - `rows` replaces the `INSIGHTS_ROWS` import (already filtered by branch in
 *     the server loader).
 *   - `branches` backs the `getBranch` lookup (mirrors mockup helper).
 *   - `branch` is the active `?branch=` filter, used for the header sub-label.
 *
 * Tab pills + range buttons stay local UI state. The range buttons (7/30/90)
 * are cosmetic only.
 * TODO[v2-wire-db]: range refetch — wire range to loadInsights(branch, days).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ic, Pill, StatTile, fmtTHB } from "@/components/clawfleet/v2/chrome";
import type { Branch, InsightRow } from "@/lib/clawfleet/v2-data";

type TabId = "round" | "branch" | "staff" | "sku" | "audit";
type RangeId = "7" | "30" | "90" | "custom";

export function InsightsClient({
  branch,
  rows,
  branches,
  days = 7,
}: {
  branch: string;
  rows: InsightRow[];
  branches: Branch[];
  days?: number;
}) {
  const router = useRouter();
  const [range, setRange] = useState<RangeId>(String(days) as RangeId);
  const [tab, setTab] = useState<TabId>("round");

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const getBranch = (id: string): Branch => branchMap.get(id) ?? ({ id, name: id, code: id } as Branch);

  // group aggregates for the branch / staff tabs
  const byBranch = useMemo(() => {
    const m = new Map<string, { cash: number; rounds: number; review: number; prize: number }>();
    for (const r of rows) {
      const e = m.get(r.branchId) ?? { cash: 0, rounds: 0, review: 0, prize: 0 };
      e.cash += r.actualCash;
      e.rounds += 1;
      e.review += r.status === "review" ? 1 : 0;
      e.prize += r.prizeOut;
      m.set(r.branchId, e);
    }
    return [...m.entries()].sort((a, b) => b[1].cash - a[1].cash);
  }, [rows]);

  const byStaff = useMemo(() => {
    const m = new Map<string, { cash: number; rounds: number; review: number; prize: number }>();
    for (const r of rows) {
      const e = m.get(r.staff) ?? { cash: 0, rounds: 0, review: 0, prize: 0 };
      e.cash += r.actualCash;
      e.rounds += 1;
      e.review += r.status === "review" ? 1 : 0;
      e.prize += r.prizeOut;
      m.set(r.staff, e);
    }
    return [...m.entries()].sort((a, b) => b[1].cash - a[1].cash);
  }, [rows]);

  function setDays(r: RangeId) {
    setRange(r);
    if (r === "custom") return;
    const qs = new URLSearchParams();
    if (branch !== "all") qs.set("branch", branch);
    qs.set("days", r);
    router.push(`/clawfleet/v2/insights?${qs.toString()}`);
  }

  function pickTab(id: TabId) {
    if (id === "sku") return router.push("/clawfleet/v2/stock");
    if (id === "audit") return router.push("/clawfleet/v2/audit");
    setTab(id);
  }

  function exportCsv() {
    const header = ["เวลา", "รอบ", "สาขา", "พนักงาน", "คาดเงิน", "เงินจริง", "ตุ๊กตา", "สถานะ"];
    const body = rows.map((r) => [
      r.time, r.id, getBranch(r.branchId).name, r.staff,
      r.expectedCash, r.actualCash, r.prizeOut, r.status,
    ]);
    const csv = [header, ...body]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clawfleet-insights-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCash = rows.reduce((s, r) => s + r.actualCash, 0);
  const reviewCount = rows.filter((r) => r.status === "review").length;
  const anomalyRate = rows.length ? Math.round((reviewCount / rows.length) * 100) : 0;

  const tabs: { id: TabId; name: string }[] = [
    { id: "round", name: "รอบเก็บ" },
    { id: "branch", name: "สาขา" },
    { id: "staff", name: "พนักงาน" },
    { id: "sku", name: "SKU" },
    { id: "audit", name: "Audit log" },
  ];

  const ranges: RangeId[] = ["7", "30", "90", "custom"];

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Insights</div>
          <h1 className="cf-h1">รายการรอบเก็บ · {days} วันล่าสุด</h1>
          <div className="cf-page-sub">
            {rows.length} รายการ · รวม {fmtTHB(totalCash)} ·{" "}
            {branch === "all" ? "10 สาขา" : getBranch(branch).name}
          </div>
        </div>
        <div className="cf-page-actions">
          <button className="cf-btn cf-btn-ghost" onClick={exportCsv}>
            <Ic name="download" size={14} /> CSV
          </button>
        </div>
      </div>

      <div className="cf-insight-cards">
        <StatTile
          label="รายได้รวม"
          value={fmtTHB(totalCash)}
          sub={`รวม 7 วัน · ${rows.length} รอบ`}
          tone="primary"
          icon="trend"
          trend={14}
        />
        <StatTile
          label="รอบที่ผ่าน"
          value={rows.filter((r) => r.status === "ok").length}
          sub="ไม่มี anomaly"
          icon="check"
          tone="neutral"
        />
        <StatTile
          label="Anomaly rate"
          value={`${anomalyRate}%`}
          sub={`${reviewCount} รอบ flagged`}
          tone="amber"
          icon="alert"
        />
        <StatTile
          label="ตุ๊กตาคีบไป"
          value={rows.reduce((s, r) => s + r.prizeOut, 0)}
          sub="ผลรวม 7 วัน"
          icon="package"
        />
      </div>

      <div className="cf-insight-toolbar">
        <div className="cf-insight-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`cf-pillbar-item ${tab === t.id ? "is-active" : ""}`}
              onClick={() => pickTab(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="cf-insight-range">
          {ranges.map((r) => (
            <button
              key={r}
              className={`cf-range-btn ${range === r ? "is-active" : ""}`}
              onClick={() => setDays(r)}
            >
              {r === "custom" ? "กำหนดเอง" : `${r} วัน`}
            </button>
          ))}
        </div>
      </div>

      {tab === "round" && (
      <div className="cf-table">
        <div className="cf-table-head">
          <div>เวลา</div>
          <div>รอบ</div>
          <div>สาขา</div>
          <div>พนักงาน</div>
          <div className="cf-table-r">คาดเงิน</div>
          <div className="cf-table-r">เงินจริง</div>
          <div className="cf-table-r">ตุ๊กตา</div>
          <div>สถานะ</div>
        </div>
        {rows.map((r, i) => {
          const info = getBranch(r.branchId);
          const gap = r.actualCash - r.expectedCash;
          return (
            <div key={i} className="cf-table-row">
              <div className="cf-table-time">{r.time}</div>
              <div className="cf-table-id">{r.id}</div>
              <div>
                <div className="cf-table-machine">{info.name}</div>
                <div className="cf-dim">{info.area}</div>
              </div>
              <div>{r.staff}</div>
              <div className="cf-table-r">{fmtTHB(r.expectedCash)}</div>
              <div className="cf-table-r">
                <strong>{fmtTHB(r.actualCash)}</strong>
                {gap < 0 && (
                  <div className="cf-text-red">{fmtTHB(Math.abs(gap)).replace("฿", "-฿")}</div>
                )}
              </div>
              <div className="cf-table-r">{r.prizeOut} ตัว</div>
              <div>
                {r.status === "ok" && (
                  <Pill color="emerald" size="sm" dot>
                    ผ่าน
                  </Pill>
                )}
                {r.status === "review" && (
                  <Pill color="red" size="sm" dot>
                    รอตรวจ · {r.severity}
                  </Pill>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {tab === "branch" && (
        <AggTable
          label="สาขา"
          rows={byBranch.map(([id, v]) => ({ name: getBranch(id).name, ...v }))}
        />
      )}
      {tab === "staff" && (
        <AggTable label="พนักงาน" rows={byStaff.map(([name, v]) => ({ name, ...v }))} />
      )}
    </div>
  );
}

function AggTable({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; cash: number; rounds: number; review: number; prize: number }[];
}) {
  const cols = { display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" } as const;
  return (
    <div className="cf-table">
      <div className="cf-table-head" style={cols}>
        <div>{label}</div>
        <div className="cf-table-r">รายได้</div>
        <div className="cf-table-r">รอบ</div>
        <div className="cf-table-r">ต้องตรวจ</div>
        <div className="cf-table-r">ตุ๊กตา</div>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="cf-table-row" style={cols}>
          <div className="cf-table-machine">{r.name}</div>
          <div className="cf-table-r">
            <strong>{fmtTHB(r.cash)}</strong>
          </div>
          <div className="cf-table-r">{r.rounds}</div>
          <div className="cf-table-r">
            {r.review > 0 ? <span className="cf-text-amber">{r.review}</span> : "0"}
          </div>
          <div className="cf-table-r">{r.prize}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="cf-table-row">ไม่มีข้อมูล</div>}
    </div>
  );
}
