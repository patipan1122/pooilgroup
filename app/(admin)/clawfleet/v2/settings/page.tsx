/**
 * ClawFleet v2 — Settings page (real data, replaces placeholder).
 * Read-only configuration snapshot + links to v1 admin for editing.
 */

import Link from "next/link";
import { Ic, StatTile, Section } from "@/components/clawfleet/v2/chrome";
import { getSettingsData } from "@/lib/clawfleet/v2-admin-queries";

export const dynamic = "force-dynamic";

function ConfigRow({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--cf-border-soft)",
      }}
    >
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 550 }}>{label}</div>
        <div className="cf-dim" style={{ fontSize: 11.5, marginTop: 2 }}>
          {help}
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--cf-text)" }}>{value}</div>
    </div>
  );
}

export default async function SettingsPage() {
  const { counts, config } = await getSettingsData();

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">ตั้งค่า</div>
          <h1 className="cf-h1">การตั้งค่าระบบตู้คีบ</h1>
          <div className="cf-page-sub">
            ค่าปริยายของระบบ (กฎ cross-check · เก็บรูป · ปิดรอบอัตโนมัติ) · แก้ได้ที่หน้าตั้งค่าเดิม
          </div>
        </div>
        <div className="cf-page-actions">
          <Link href="/clawfleet/setup" className="cf-btn cf-btn-primary">
            <Ic name="settings" size={14} /> ไปหน้าตั้งค่าเดิม
          </Link>
        </div>
      </div>

      <div className="cf-insight-cards">
        <StatTile label="สาขา" value={counts.branches} sub="claw_machine" icon="building" tone="primary" />
        <StatTile label="ตู้คีบ" value={counts.claws} sub={`+ ตู้แลก ${counts.exchangers}`} icon="package" />
        <StatTile label="สินค้า" value={counts.products} sub="ทั้งหมดในระบบ" icon="cube" />
        <StatTile label="รวมตู้" value={counts.machines} sub="claw + exchanger" icon="layers" />
      </div>

      <Section title="กฎ cross-check (ค่าปริยาย)" sub="แก้ในโค้ดที่ lib/clawfleet/types.ts (DEFAULTS) · settings UI เฟสถัดไป">
        <ConfigRow
          label="เงินขาดได้สูงสุด (tolerance)"
          value={`${config.groupTolerancePct}%`}
          help="ของรอบเก็บก่อนระบบ flag เป็น anomaly"
        />
        <ConfigRow
          label="เงินขาด ‘ยอมรับได้’"
          value={`฿${config.cashAcceptableBaht.toLocaleString()}`}
          help="ต่ำกว่านี้ ไม่ flag · เกินจะ flag M2"
        />
        <ConfigRow
          label="เงินขาด ‘เตือน’"
          value={`฿${config.cashWarnBaht.toLocaleString()}`}
          help="เกินค่านี้ flag M3 (เงินขาดเยอะ)"
        />
        <ConfigRow
          label="ตุ๊กตาขาด ‘ยอมรับได้’"
          value={`${config.dollVarianceAcceptable} ตัว`}
          help="ต่ำกว่านี้ ไม่ flag (P2)"
        />
        <ConfigRow
          label="ตุ๊กตาขาด ‘เตือน’"
          value={`${config.dollVariancePct}%`}
          help="เกิน % นี้จากที่แจก flag P3"
        />
        <ConfigRow
          label="Promo discount สูงสุด"
          value={`${config.promoMaxPct}%`}
          help="ตู้แลก: เกินจะ flag G6"
        />
      </Section>

      <Section title="การเก็บรูป + ปิดรอบ" sub="เปลี่ยนได้ในโค้ด">
        <ConfigRow
          label="เก็บรูปไว้กี่วัน"
          value={`${config.photoRetentionDays} วัน`}
          help="หลังจากนั้น cron จะลบรูปของรอบที่ปิด (ยกเว้น anomaly/locked)"
        />
        <ConfigRow
          label="ปิดรอบอัตโนมัติเมื่อค้าง"
          value={`${config.sessionAutoCloseHours} ชม.`}
          help="cron ปิดรอบที่ยังเปิดเกินเวลานี้"
        />
        <ConfigRow
          label="ฐานคำนวณรายได้ผิดปกติ"
          value={`${config.baselineDays} วัน`}
          help="ใช้เทียบ median รายได้ตู้ เพื่อ flag A1"
        />
      </Section>
    </div>
  );
}
