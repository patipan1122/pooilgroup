/**
 * ClawFleet v2 — Audit log (real data, replaces placeholder).
 * Derived feed: session reviews + stock adjustments + central deliveries.
 * No new table required.
 */

import { Ic, Pill } from "@/components/clawfleet/v2/chrome";
import { getAuditFeed, type AuditAction } from "@/lib/clawfleet/v2-admin-queries";

export const dynamic = "force-dynamic";

function actionTone(action: AuditAction): "emerald" | "amber" | "red" | "blue" | "slate" {
  switch (action) {
    case "approve":
      return "emerald";
    case "recheck":
      return "amber";
    case "escalate":
      return "red";
    case "delivery":
      return "blue";
    case "adjust":
    case "receive":
      return "slate";
  }
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(d);
}

export default async function AuditPage() {
  const entries = await getAuditFeed(80);

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Audit log</div>
          <h1 className="cf-h1">ประวัติการตัดสินใจ · 80 รายการล่าสุด</h1>
          <div className="cf-page-sub">
            อนุมัติรอบ · ตรวจซ้ำ · ส่งต่อ · ปรับสต๊อก · รับของ · สั่งคลังกลาง
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            background: "var(--cf-surface)",
            border: "1px solid var(--cf-border)",
            borderRadius: "var(--cf-radius)",
          }}
          className="cf-dim"
        >
          ยังไม่มีรายการในประวัติ
        </div>
      ) : (
        <div className="cf-table">
          <div
            className="cf-table-head"
            style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 1.4fr 2fr" }}
          >
            <div>เวลา</div>
            <div>การกระทำ</div>
            <div>สาขา</div>
            <div>เป้าหมาย</div>
            <div>โดย / รายละเอียด</div>
          </div>
          {entries.map((e) => (
            <div
              key={e.id}
              className="cf-table-row"
              style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 1.4fr 2fr" }}
            >
              <div className="cf-table-time">{fmtTime(e.at)}</div>
              <div>
                <Pill color={actionTone(e.action)} size="sm" dot>
                  {e.actionLabel}
                </Pill>
              </div>
              <div>
                <span className="cf-table-machine">{e.branchName}</span>
              </div>
              <div>
                <span style={{ fontWeight: 600 }}>{e.target}</span>
              </div>
              <div>
                <div style={{ fontSize: 12.5 }}>
                  <Ic name="user" size={12} /> {e.actor}
                </div>
                {e.detail && (
                  <div className="cf-dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {e.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
