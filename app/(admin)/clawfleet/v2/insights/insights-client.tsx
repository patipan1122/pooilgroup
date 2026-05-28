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
import { Ic, Pill, StatTile, fmtTHB } from "@/components/clawfleet/v2/chrome";
import type { Branch, InsightRow } from "@/lib/clawfleet/v2-data";

type TabId = "round" | "branch" | "staff" | "sku" | "audit";
type RangeId = "7" | "30" | "90" | "custom";

export function InsightsClient({
  branch,
  rows,
  branches,
}: {
  branch: string;
  rows: InsightRow[];
  branches: Branch[];
}) {
  const [range, setRange] = useState<RangeId>("7");
  const [tab, setTab] = useState<TabId>("round");

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const getBranch = (id: string): Branch => branchMap.get(id) ?? ({ id, name: id, code: id } as Branch);

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
          <h1 className="cf-h1">รายการรอบเก็บ · 7 วันล่าสุด</h1>
          <div className="cf-page-sub">
            {rows.length} รายการ · รวม {fmtTHB(totalCash)} ·{" "}
            {branch === "all" ? "10 สาขา" : getBranch(branch).name}
          </div>
        </div>
        <div className="cf-page-actions">
          <button className="cf-btn cf-btn-ghost">
            <Ic name="filter" size={14} /> ตัวกรอง
          </button>
          <button className="cf-btn cf-btn-ghost">
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
              onClick={() => setTab(t.id)}
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
              onClick={() => setRange(r)}
            >
              {r === "custom" ? "กำหนดเอง" : `${r} วัน`}
            </button>
          ))}
        </div>
      </div>

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
    </div>
  );
}
