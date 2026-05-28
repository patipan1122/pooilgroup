"use client";

/**
 * ClawFleet v2 — Stock client island.
 *
 * Renders the inner `.cf-page` content (branch-chip selector + active-branch
 * overview + deliveries + SKU table) ported verbatim from the mockup. Data now
 * arrives as props from the server `page.tsx`:
 *   - `branches` replaces the `BRANCHES` import.
 *   - `stockByBranch` replaces the `BRANCH_STOCK` + `DELIVERIES` imports — keyed
 *     by branch id so the chip selector can switch branches client-side with no
 *     extra round-trip.
 *   - `getBranch` is a lookup over the `branches` prop (mirrors mockup helper).
 */

import { useMemo, useState } from "react";
import { Ic, Pill } from "@/components/clawfleet/v2/chrome";
import type { Branch } from "@/lib/clawfleet/v2-data";
import type { BranchStock } from "./page";

const EMPTY_STOCK: BranchStock = { stock: [], deliveries: [] };

export function StockClient({
  branches,
  initialBranchId,
  stockByBranch,
}: {
  branches: Branch[];
  initialBranchId: string;
  stockByBranch: Record<string, BranchStock>;
}) {
  const [activeBranch, setActiveBranch] = useState<string>(initialBranchId);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const getBranch = (id: string): Branch => branchMap.get(id) ?? ({ id, name: id, code: id } as Branch);

  const { stock, deliveries: branchDeliveries } = stockByBranch[activeBranch] ?? EMPTY_STOCK;
  const branchInfo = getBranch(activeBranch);
  const lows = stock.filter((s) => s.warehouse <= 4 || s.warehouse + s.inMachines <= 20);
  const totalWarehouse = stock.reduce((s, x) => s + x.warehouse, 0);
  const totalInMachines = stock.reduce((s, x) => s + x.inMachines, 0);

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Stock</div>
          <h1 className="cf-h1">ของรางวัล · 10 SKU/สาขา</h1>
          <div className="cf-page-sub">คลังสาขา + ในตู้ · เติมจากคลังกลาง บางนา</div>
        </div>
        <div className="cf-page-actions">
          <button type="button" className="cf-btn cf-btn-ghost">
            <Ic name="download" size={14} /> รายงาน
          </button>
          <button type="button" className="cf-btn cf-btn-primary">
            <Ic name="plus" size={14} /> สั่งจากคลังกลาง
          </button>
        </div>
      </div>

      {/* Branch picker chips */}
      <div className="cf-branch-chips">
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`cf-branch-chip ${activeBranch === b.id ? "is-active" : ""}`}
            onClick={() => setActiveBranch(b.id)}
          >
            <span className={`cf-branch-chip-flag cf-branch-flag-${b.tone}`}>{b.avatar}</span>
            <span>{b.name}</span>
            <span className="cf-dim">{b.machines}</span>
          </button>
        ))}
      </div>

      {/* Active branch overview */}
      <div className="cf-stock-overview">
        <div className="cf-stock-overview-head">
          <div>
            <div className="cf-eyebrow">{branchInfo.area ?? "—"}</div>
            <h2 className="cf-h2">{branchInfo.name}</h2>
            <div className="cf-page-sub">
              {branchInfo.code} · {branchInfo.machines ?? 0} ตู้ · ผจก. {branchInfo.manager ?? "—"}
            </div>
          </div>
          <div className="cf-stock-overview-stats">
            <div className="cf-stock-stat">
              <div className="cf-dim">คลังสาขา</div>
              <div className="cf-stock-stat-val">{totalWarehouse}</div>
              <div className="cf-dim">ตัว</div>
            </div>
            <div className="cf-stock-stat">
              <div className="cf-dim">ในตู้</div>
              <div className="cf-stock-stat-val">{totalInMachines}</div>
              <div className="cf-dim">ตัว</div>
            </div>
            <div className="cf-stock-stat">
              <div className="cf-dim">ใกล้หมด</div>
              <div className={`cf-stock-stat-val ${lows.length > 0 ? "cf-text-red" : ""}`}>
                {lows.length}
              </div>
              <div className="cf-dim">SKU</div>
            </div>
            <div className="cf-stock-stat">
              <div className="cf-dim">รถส่ง</div>
              <div className="cf-stock-stat-val">{branchDeliveries.length}</div>
              <div className="cf-dim">เที่ยว</div>
            </div>
          </div>
        </div>

        {branchDeliveries.length > 0 && (
          <div className="cf-stock-deliv">
            {branchDeliveries.map((d) => (
              <div key={d.id} className="cf-stock-deliv-row">
                <Pill color={d.status === "in_transit" ? "blue" : "slate"} size="sm" dot>
                  {d.status === "in_transit" ? "กำลังส่ง" : "นัดส่ง"}
                </Pill>
                <span>
                  <strong>
                    {d.units} ตัว · {d.items} SKU
                  </strong>
                </span>
                <span className="cf-dim">
                  {d.from} · ETA {d.eta}
                </span>
                <span className="cf-dim cf-stock-deliv-id">{d.id}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SKU table */}
      <div className="cf-table">
        <div className="cf-stock-table-head">
          <div>SKU</div>
          <div className="cf-table-r">คลังสาขา</div>
          <div className="cf-table-r">ในตู้</div>
          <div className="cf-table-r">รวม</div>
          <div>ใช้ต่อวัน</div>
          <div>คงอยู่ได้</div>
          <div>เติมล่าสุด</div>
          <div></div>
        </div>
        {stock.map((s) => {
          const total = s.warehouse + s.inMachines;
          const daysLeft = s.velocity > 0 ? Math.floor(total / s.velocity) : 99;
          const isLow = s.warehouse <= 4 || total <= 20;
          const isCritical = s.warehouse === 0;
          return (
            <div
              key={s.sku}
              className={`cf-stock-table-row ${isLow ? "is-low" : ""} ${isCritical ? "is-critical" : ""}`}
            >
              <div className="cf-stock-sku">
                <div className="cf-stock-sku-name">{s.name}</div>
                <div className="cf-dim cf-stock-sku-code">
                  {s.sku} · ต้นทุน ฿{s.cost}
                </div>
              </div>
              <div className="cf-table-r">
                <strong className={isCritical ? "cf-text-red" : isLow ? "cf-text-amber" : ""}>
                  {s.warehouse}
                </strong>
              </div>
              <div className="cf-table-r">
                <strong>{s.inMachines}</strong>
              </div>
              <div className="cf-table-r">
                <strong>{total}</strong>
              </div>
              <div>~{s.velocity}/วัน</div>
              <div className={daysLeft <= 2 ? "cf-text-red" : daysLeft <= 5 ? "cf-text-amber" : ""}>
                {daysLeft} วัน
              </div>
              <div className="cf-dim">{s.lastDelivery}</div>
              <div className="cf-stock-row-cta">
                {isLow && (
                  <button type="button" className="cf-btn cf-btn-primary cf-btn-sm">
                    สั่งเติม
                  </button>
                )}
                {!isLow && (
                  <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm">
                    ดู
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
