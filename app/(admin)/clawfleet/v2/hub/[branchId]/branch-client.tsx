"use client";

/**
 * ClawFleet v2 — Branch drill-in client.
 * คงลุคเดิม (แถบน้ำเงิน ตัวขาว · class .cf-*). ทุกลิงก์ของจริง.
 */

import { useRouter } from "next/navigation";
import { Ic, Pill, Section } from "@/components/clawfleet/v2/chrome";
import type {
  BranchPnl,
  MachinePnl,
  BranchSessionRow,
  PnlFlagInfo,
} from "@/lib/clawfleet/pnl-queries";

function baht(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function FlagPill({ flag }: { flag: PnlFlagInfo }) {
  return (
    <Pill color={flag.tone} size="sm" dot={flag.flag !== "NODATA"}>
      {flag.label}
    </Pill>
  );
}

export function BranchDrillClient({
  branch,
  summary,
  machines,
  history,
}: {
  branch: { id: string; name: string; code: string; area: string };
  summary: BranchPnl | null;
  machines: MachinePnl[];
  history: BranchSessionRow[];
}) {
  const router = useRouter();
  const profitPositive = (summary?.profit ?? 0) >= 0;
  const riskyCount = machines.filter(
    (m) => m.flag.flag === "LOW" || m.flag.flag === "LOSS" || m.flag.flag === "HIGH",
  ).length;

  return (
    <div className="cf-page">
      {/* Header + back */}
      <div className="cf-greeting">
        <div>
          <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => router.push("/clawfleet/v2/hub")}>
            <Ic name="chevronL" size={14} /> กลับหน้ารวม
          </button>
          <h1 className="cf-h1" style={{ marginTop: 8 }}>
            {branch.name}
          </h1>
          <div className="cf-eyebrow">{branch.area} · {branch.code}</div>
        </div>
      </div>

      {/* Branch P&L summary — แถบน้ำเงิน */}
      <div className="cf-hero is-split">
        <div className="cf-hero-revenue">
          <div className="cf-hero-label">เงินเก็บวันนี้ · {summary?.sessions ?? 0} รอบ</div>
          <div className="cf-hero-amount">
            <span className="cf-hero-currency">฿</span>
            <span className="cf-hero-num">{baht(summary?.revenue ?? 0)}</span>
          </div>
          <div className="cf-hero-meta">
            {summary?.hasCost ? (
              <Pill color={profitPositive ? "emerald" : "red"} size="sm" dot>
                {profitPositive ? "กำไร" : "ขาดทุน"} ฿{baht(Math.abs(summary?.profit ?? 0))}
              </Pill>
            ) : (
              <Pill color="slate" size="sm">ยังไม่ตั้งต้นทุนตุ๊กตา</Pill>
            )}
            <span className="cf-dim">ตุ๊กตาออก {baht(summary?.dollsOut ?? 0)} ตัว</span>
          </div>
          {summary?.avgBahtPerDoll != null && (
            <div className="cf-hero-avg">
              <div className="cf-hero-avg-num">฿{baht(summary.avgBahtPerDoll)}</div>
              <div className="cf-hero-avg-lbl">ค่าเฉลี่ยบาท / ตุ๊กตา 1 ตัว</div>
            </div>
          )}
        </div>
        <div className="cf-hero-action">
          <div className="cf-hero-action-label">
            <Ic name="alert" size={14} />
            <span>สถานะสาขา</span>
          </div>
          <div className="cf-hero-cta" style={{ cursor: "default" }}>
            <div className="cf-hero-cta-main">
              <div className="cf-hero-cta-title">
                {summary ? <FlagPill flag={summary.flag} /> : "ยังไม่มีข้อมูล"}
              </div>
              <div className="cf-hero-cta-sub">
                {riskyCount > 0
                  ? `🔴 ตู้เสี่ยงขาดทุน ${riskyCount} ตู้ · ควรโทรบอกพนักงานตั้งค่าตู้ใหม่`
                  : "ทุกตู้อยู่ในเกณฑ์ดี"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-machine P&L */}
      <Section
        title={`ตู้คีบในสาขา · ${machines.length} ตู้`}
        sub="ค่าเฉลี่ยบาท/ตัว + ธง · ตู้ที่เสี่ยงขึ้นก่อน · ตั้งค่านานแล้ว + ธงแย่ = ควรโทรบอกพนักงาน"
      >
        <div className="cf-branch-list">
          {machines.map((m) => (
            <MachinePnlRow key={m.machineId} m={m} />
          ))}
          {machines.length === 0 && (
            <div className="cf-dim" style={{ padding: "16px 4px" }}>
              ยังไม่มีตู้คีบในสาขานี้
            </div>
          )}
        </div>
      </Section>

      {/* Collection history */}
      <Section
        title="ประวัติการเก็บเงิน"
        sub={`${history.length} รอบล่าสุดที่ปิดแล้ว`}
      >
        <div className="cf-ops-table">
          {history.map((h) => {
            const profitPos = h.profit >= 0;
            return (
              <div
                key={h.sessionCode}
                className={`cf-ops-row ${h.anomaly ? "cf-ops-row-review" : "cf-ops-row-closed"}`}
              >
                <div className="cf-ops-zone">
                  <div className="cf-branch-name">{h.closedLabel}</div>
                  <div className="cf-ops-staff">{h.staff} · {h.sessionCode}</div>
                </div>
                <div className="cf-ops-rev" style={{ textAlign: "right" }}>
                  <div className="cf-branch-rev">฿{baht(h.revenue)}</div>
                  {h.hasCost && (
                    <div className={`cf-pnl-profit ${profitPos ? "is-up" : "is-down"}`}>
                      {profitPos ? "กำไร" : "ขาดทุน"} ฿{baht(Math.abs(h.profit))}
                    </div>
                  )}
                  <div className="cf-dim cf-pnl-sub">ตุ๊กตา {baht(h.dollsOut)} ตัว</div>
                </div>
                <div className="cf-ops-time">
                  {h.anomaly ? (
                    <Pill color="red" size="sm" dot>รอตรวจ</Pill>
                  ) : (
                    <Pill color="emerald" size="sm" dot>ปิดแล้ว</Pill>
                  )}
                </div>
              </div>
            );
          })}
          {history.length === 0 && (
            <div className="cf-dim" style={{ padding: "16px 4px" }}>
              ยังไม่มีรอบที่ปิดแล้วในสาขานี้
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

/** แถวตู้ — avg เด่น + ธง + ตั้งค่าล่าสุด + ใครเก็บ · ตู้เสี่ยงไฮไลต์ */
function MachinePnlRow({ m }: { m: MachinePnl }) {
  const risky = m.flag.flag === "LOW" || m.flag.flag === "LOSS" || m.flag.flag === "HIGH";
  const profitPositive = m.profit >= 0;
  return (
    <div className={`cf-branch-row cf-pnl-row ${risky ? "cf-pnl-row-risky" : ""}`}>
      <div className="cf-branch-left">
        <div className={`cf-pnl-avg cf-pnl-avg-${m.flag.tone}`}>
          {m.avgBahtPerDoll != null ? (
            <>
              <span className="cf-pnl-avg-num">฿{baht(m.avgBahtPerDoll)}</span>
              <span className="cf-pnl-avg-unit">/ตัว</span>
            </>
          ) : (
            <span className="cf-pnl-avg-na">—</span>
          )}
        </div>
        <div>
          <div className="cf-branch-name">{m.nickname ?? m.code}</div>
          <div className="cf-branch-meta">
            <FlagPill flag={m.flag} />
            <span className="cf-dim">·</span>
            <span>{m.code}</span>
          </div>
          <div className="cf-branch-meta" style={{ marginTop: 2 }}>
            <span className="cf-dim">
              <Ic name="settings" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />
              ตั้งค่า {m.lastConfiguredLabel}
            </span>
            <span className="cf-dim">·</span>
            <span className="cf-dim">เก็บล่าสุด {m.lastCollectedLabel}{m.lastCollectedBy ? ` (${m.lastCollectedBy})` : ""}</span>
          </div>
          {(risky || m.configStale) && (
            <div className="cf-pnl-warn">
              🔴 {m.configStale ? "ตั้งค่านานแล้ว + " : ""}ควรโทรบอกพนักงานตั้งค่าตู้ใหม่
            </div>
          )}
        </div>
      </div>
      <div className="cf-branch-right">
        <div className="cf-branch-rev">฿{baht(m.revenue)}</div>
        {m.hasCost ? (
          <div className={`cf-pnl-profit ${profitPositive ? "is-up" : "is-down"}`}>
            {profitPositive ? "กำไร" : "ขาดทุน"} ฿{baht(Math.abs(m.profit))}
          </div>
        ) : (
          <div className="cf-dim cf-pnl-profit">ยังไม่ตั้งต้นทุน</div>
        )}
        <div className="cf-dim cf-pnl-sub">ตุ๊กตา {baht(m.dollsOut)} ตัว</div>
      </div>
    </div>
  );
}
