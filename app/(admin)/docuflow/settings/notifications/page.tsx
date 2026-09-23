// DocuFlow · Settings → Notifications (honest placeholder, not fake toggles)
// ────────────────────────────────────────────────────────────────────
// DocuFlow redesign Track A · Item 1.
//
// IMPORTANT — this intentionally does NOT move the old channel-toggle UI
// from /docuflow/notifications (:341-393 "ช่องทางแจ้งเตือน", :396-431
// "เตือนล่วงหน้า") here. That UI was 100% hardcoded — literal `on: true`
// booleans with no onClick and no persistence, same non-functional-UI bug
// class the redesign already removed from /docuflow/workflow's fake
// "142 ครั้ง" stat. Relocating it verbatim into a page literally named
// "settings" would make things worse, not better: it would look like a
// working settings panel exactly where an admin expects one to be real.
//
// What's actually true today, reflected honestly below:
//   - "ในระบบ" (in-app notification feed) IS real — /docuflow/notifications
//     itself computes live alerts from renewals/signatures/uploads.
//   - Email / LINE OA / SMS / Push delivery channels are NOT wired up.
//     LINE OA notifications specifically were deferred by the CEO to a
//     later phase (Track B) — labelled accordingly, not hidden.
//   - The 90/30/7/0-day reminder windows ARE the real system default used
//     by the expiry engine (lib/docuflow/expiry.ts + DocumentRenewal.
//     alertDays) — shown as read-only info, not an editable-looking list.
// Gate: requireProgramAdminTier (see settings/page.tsx header comment).
// ────────────────────────────────────────────────────────────────────

import { ArrowLeft, Bell, Mail, MessageCircle, Smartphone, Info } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireProgramAdminTier } from "@/lib/auth/role-guards";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

interface ChannelRow {
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: string;
  tone: "success" | "warn" | "outline";
}

const CHANNELS: ChannelRow[] = [
  {
    icon: <Bell size={18} />,
    title: "ในระบบ (Inbox)",
    desc: "แจ้งเตือนเอกสารใกล้หมดอายุ · รอเซ็น · อัปโหลดใหม่ — ดูที่ /docuflow/notifications",
    status: "ทำงานอยู่",
    tone: "success",
  },
  {
    icon: <Mail size={18} />,
    title: "อีเมล",
    desc: "ส่งอีเมลแจ้งเตือนแยกจาก Inbox ในระบบ",
    status: "ยังไม่เปิดใช้งาน",
    tone: "outline",
  },
  {
    icon: <MessageCircle size={18} />,
    title: "LINE OA",
    desc: "ส่ง LINE แจ้งเตือนถึงผู้รับผิดชอบโดยตรง",
    status: "คิวพร้อม (Track B)",
    tone: "warn",
  },
  {
    icon: <Smartphone size={18} />,
    title: "SMS / Push (มือถือ)",
    desc: "แจ้งเตือนผ่าน SMS หรือ push notification บนมือถือ",
    status: "ยังไม่เปิดใช้งาน",
    tone: "outline",
  },
];

const REMINDER_DAYS = ["90 วันก่อนหมดอายุ", "30 วันก่อนหมดอายุ", "7 วันก่อนหมดอายุ", "วันที่หมดอายุ"];

export default async function NotificationSettingsPage() {
  const session = await requireSession();
  requireProgramAdminTier(session.user.role);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <DfTopBanner
        breadcrumbs={[
          { label: "หน้าหลัก", href: "/docuflow" },
          { label: "ตั้งค่า", href: "/docuflow/settings" },
          { label: "การแจ้งเตือน" },
        ]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>ตั้งค่า · การแจ้งเตือน</DfEyebrow>}
        title="การแจ้งเตือน"
        description="สถานะช่องทางแจ้งเตือนของ DocuFlow ตามความเป็นจริง"
        actions={
          <DfButton href="/docuflow/settings" variant="ghost" size="sm">
            <ArrowLeft size={14} />
            กลับหน้าตั้งค่า
          </DfButton>
        }
      />

      <DfSection number="01" label="ช่องทางแจ้งเตือน" className="df-fade-up df-fade-up-100">
        <DfCard padding={0} style={{ overflow: "hidden" }}>
          {CHANNELS.map((c, i) => (
            <div
              key={c.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 20px",
                borderBottom: i < CHANNELS.length - 1 ? "1px solid var(--df-line-soft)" : "none",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "var(--df-bg-warm)",
                  color: "var(--df-ink-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {c.icon}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--df-ink)" }}>
                  {c.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--df-muted)", marginTop: 2 }}>
                  {c.desc}
                </div>
              </div>
              <DfPill tone={c.tone} small>
                {c.status}
              </DfPill>
            </div>
          ))}
        </DfCard>
      </DfSection>

      <DfSection
        number="02"
        label="รอบเตือนล่วงหน้า"
        description="ค่าเริ่มต้นของระบบ ใช้กับเอกสารทุกฉบับที่มีวันหมดอายุ"
        className="df-fade-up df-fade-up-200"
      >
        <DfCard padding={18}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {REMINDER_DAYS.map((d) => (
              <DfPill key={d} tone="ink" small>
                {d}
              </DfPill>
            ))}
          </div>
        </DfCard>
      </DfSection>

      <DfCard padding={16} warm style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Info size={16} style={{ color: "var(--df-muted)", flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 12, color: "var(--df-ink-2)", margin: 0, lineHeight: 1.6 }}>
          หน้านี้แสดงสถานะจริงเท่านั้น — ยังไม่มีสวิตช์เปิด/ปิดช่องทางแยกรายบุคคล เพราะยังไม่มีระบบส่งจริงรองรับ
          (อีเมล/LINE/SMS) การเปิดใช้งานช่องทางเหล่านี้เป็นแผนงานเฟสถัดไป
        </p>
      </DfCard>
    </div>
  );
}
