// ClawHub (JOLLY PLAY) — settings (super_admin only).
// Shows the locked config (env-controlled, read-only), an env-readiness checklist
// (which CLAWHUB_* env are present — never prints secret VALUES), and a button to
// (re)install the LINE rich menu.

import { redirect } from "next/navigation";
import { requireClawhubAdmin } from "@/lib/clawhub/access";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import {
  MAX_REFUND_BAHT,
  POINT_EXPIRE_DAYS,
  VISION_CONFIDENCE_FLOOR,
  POINT_TO_BAHT,
  BRAND,
  SUPPORT_PHONE,
} from "@/lib/clawhub/constants";
import { PageHeader } from "../_components/ui";
import { RichMenuButton } from "./_richmenu-button";

export const dynamic = "force-dynamic";

// CLAWHUB_* env we care about for readiness. We only report present/absent — never
// the value. Marked `secret` ones are credentials; the rest are tunables.
const ENV_CHECKS: { key: string; label: string; secret: boolean }[] = [
  { key: "CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN", label: "LINE Messaging API token", secret: true },
  { key: "CLAWHUB_LINE_CHANNEL_SECRET", label: "LINE webhook secret", secret: true },
  { key: "CLAWHUB_LINE_LOGIN_CHANNEL_ID", label: "LINE Login / LIFF channel id", secret: false },
  { key: "CLAWHUB_LIFF_ID", label: "LIFF id", secret: false },
  { key: "CLAWHUB_MAX_REFUND_BAHT", label: "เพดานคืนเงิน (บาท)", secret: false },
  { key: "CLAWHUB_POINT_EXPIRE_DAYS", label: "วันหมดอายุแต้ม", secret: false },
  { key: "CLAWHUB_VISION_CONFIDENCE_FLOOR", label: "เกณฑ์ความมั่นใจ AI", secret: false },
];

export default async function ClawhubSettingsPage() {
  const session = await requireClawhubAdmin();
  // Settings is super_admin-only (per the back-office hardening principle: DB / LINE /
  // secret surfaces are super_admin only). Others get bounced to the dashboard.
  if (!isSuperAdmin(session.user.role)) redirect("/clawhub/dashboard");

  const envStatus = ENV_CHECKS.map((c) => ({
    ...c,
    present: !!process.env[c.key] && process.env[c.key]!.trim().length > 0,
  }));

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="ตั้งค่า" accent="ClawHub" subtitle={`${BRAND} · เฉพาะ super admin`} />

      {/* Config (read-only) */}
      <h2 className="cw-title mb-2 text-lg">ค่าระบบ (ตั้งผ่าน env เท่านั้น)</h2>
      <div className="cw-card mb-6 overflow-hidden">
        <Row label="เพดานคืนเงินต่อครั้ง" value={`${MAX_REFUND_BAHT} บาท`} env="CLAWHUB_MAX_REFUND_BAHT" />
        <Row label="อัตราแลกแต้ม" value={`1 แต้ม = ${POINT_TO_BAHT} บาท`} env="(ล็อกในโค้ด)" />
        <Row label="วันหมดอายุแต้ม" value={`${POINT_EXPIRE_DAYS} วัน`} env="CLAWHUB_POINT_EXPIRE_DAYS" />
        <Row
          label="เกณฑ์ความมั่นใจ AI ขั้นต่ำ"
          value={`${Math.round(VISION_CONFIDENCE_FLOOR * 100)}%`}
          env="CLAWHUB_VISION_CONFIDENCE_FLOOR"
        />
        <Row label="เบอร์ติดต่อ (แสดงในบอท)" value={SUPPORT_PHONE} env="(ล็อกในโค้ด)" last />
      </div>
      <p className="mb-6 -mt-4 text-xs" style={{ color: "var(--cw-text-3)" }}>
        ค่าเหล่านี้แก้ได้ที่ตัวแปรสภาพแวดล้อม (Vercel env) ขึ้นต้นด้วย CLAWHUB_ เท่านั้น — แก้ในหน้านี้ไม่ได้ (กันคนแก้พลาด)
      </p>

      {/* Env readiness */}
      <h2 className="cw-title mb-2 text-lg">ความพร้อมของ env</h2>
      <div className="cw-card mb-6 overflow-hidden">
        {envStatus.map((e, i) => (
          <div
            key={e.key}
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderTop: i === 0 ? "none" : "1px solid var(--cw-border)",
            }}
          >
            <div>
              <div className="text-sm font-semibold">{e.label}</div>
              <div className="font-mono text-xs" style={{ color: "var(--cw-text-3)" }}>
                {e.key}
                {e.secret ? " · 🔒" : ""}
              </div>
            </div>
            {e.present ? (
              <span className="cw-badge cw-badge-ok">ตั้งแล้ว</span>
            ) : (
              <span className="cw-badge cw-badge-danger">ยังไม่ตั้ง</span>
            )}
          </div>
        ))}
      </div>
      <p className="mb-6 -mt-4 text-xs" style={{ color: "var(--cw-text-3)" }}>
        แสดงเฉพาะว่า “ตั้งค่าแล้วหรือยัง” ไม่แสดงค่าจริงของ secret
      </p>

      {/* Rich menu */}
      <h2 className="cw-title mb-2 text-lg">LINE Rich Menu</h2>
      <div className="cw-card p-4">
        <p className="mb-3 text-sm" style={{ color: "var(--cw-text-2)" }}>
          ติดตั้งหรืออัปเดตเมนูลัดด้านล่างของแชต LINE (ปุ่มขอคืนแต้ม / แต้มของฉัน / แลกของ ฯลฯ)
        </p>
        <RichMenuButton />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  env,
  last,
}: {
  label: string;
  value: string;
  env: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: last ? "none" : "1px solid var(--cw-border)" }}
    >
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="font-mono text-[11px]" style={{ color: "var(--cw-text-3)" }}>
          {env}
        </div>
      </div>
      <div className="cw-tnum text-sm font-bold" style={{ color: "var(--cw-brand-700)" }}>
        {value}
      </div>
    </div>
  );
}
