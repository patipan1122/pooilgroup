"use client";

/**
 * ClawFleet v2 — Hub client = แดชบอร์ดกำไร/ขาดทุน.
 *
 * โครงบนลงล่าง:
 *   1. Hero — ยอดขายรวมวันนี้ + กำไรรวม(เขียว)/ขาดทุน(แดง) + จำนวนรอบ + ค่าเฉลี่ยบาท/ตัว
 *   2. "ตอนนี้ต้องทำ" — Anomaly CTA + รอบกำลังเก็บ(OPEN) + รอตรวจ
 *   3. อันดับสาขา — เรียงแย่→ดี · ค่าเฉลี่ยบาท/ตัว(เด่น) + ธงสี + กำไร/ขาดทุน · คลิกลึกเข้าสาขา
 *   4. Anomaly CTA banner — ทางลัดไปหน้า Anomaly (ตรวจจริงที่หน้านั้นที่เดียว · ไม่ซ้ำตาราง)
 *
 * คงลุคเดิม: แถบน้ำเงิน ตัวขาว · ใช้ class .cf-* เดิมทั้งหมด ไม่ฮาร์ดโค้ดสี.
 */

import { useRouter } from "next/navigation";
import { Ic, Pill, Section } from "@/components/clawfleet/v2/chrome";
import type { Anomaly } from "@/lib/clawfleet/v2-data";
import type { BranchPnl, PnlSummary, PnlFlagInfo } from "@/lib/clawfleet/pnl-queries";

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

  const anomalies = anomaliesProp;
  const openSessions = hub.activeSessions;
  const reviewWaiting = anomalies.length;

  const totalGap = anomalies.reduce((s, a) => s + a.gap, 0);

  const goAnomalies = () => router.push("/clawfleet/v2/anomalies");
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
            <button className="cf-hero-cta" onClick={goAnomalies}>
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

        {/* Anomaly CTA — ทางลัดไปหน้า Anomaly (ตรวจจริงที่หน้านั้นที่เดียว · ไม่มีตารางซ้ำใน Hub) */}
        <Section title="Anomaly · cross-check">
          {reviewWaiting > 0 ? (
            <div
              className="cf-branch-meta"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>🔴</span>
                <div>
                  <div className="cf-branch-name">มี {reviewWaiting} รอบต้องตรวจ</div>
                  <div className="cf-dim">
                    เงิน/ตุ๊กตา ไม่ตรงรวม ฿{baht(totalGap)} · ตรวจที่หน้า Anomaly ที่เดียว
                  </div>
                </div>
              </div>
              <button className="cf-btn cf-btn-primary" onClick={goAnomalies}>
                ดูทั้งหมด <Ic name="arrowR" size={14} />
              </button>
            </div>
          ) : (
            <div className="cf-dim" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>✓</span>
              <span>ไม่มีรอบที่ต้องตรวจ · ทุกอย่างปกติ</span>
            </div>
          )}
        </Section>
      </div>
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
