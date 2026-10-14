// DocuFlow · Settings → Telegram (CEO #8 + #18, 2026-10-14)
// ────────────────────────────────────────────────────────────────────
// #18 ("setup guide / settings screen before deeper integration") — this
// page: shows whether Telegram is connected org-wide, gives plain-Thai
// step-by-step connect instructions, and lets the viewing admin connect
// their OWN account right here.
//
// #8 ("notify a signer via Telegram with buttons") — the actual send is
// lib/docuflow/telegram-notify.ts, triggered from
// app/api/docuflow/[id]/signatures/route.ts whenever a new signature-type
// placement is created for a real signerUserId. This page is the
// connect/visibility surface, not the sender.
//
// Mechanism: reuses the EXISTING users.telegram_user_id/telegram_chat_id
// columns (same fields CashHub's Telegram flows already read/write — see
// app/api/cashhub/reports/route.ts) and the EXISTING (previously unused)
// telegram_pairing_tokens table for the one-time "/start <token>" connect
// link (lib/telegram/pairing.ts). Zero new DB migration needed.
//
// Gate: requireModuleAdmin(user, "docuflow") — same convention as every
// other /docuflow/settings/* page. Note this gates the OVERVIEW page only;
// the underlying connect/disconnect action (ConnectTelegramButton →
// /api/telegram/connect|disconnect) is a personal action available to any
// signed-in user from /profile too, so a non-admin signer can still connect
// their own account there — see app/(admin)/profile/page.tsx.
// ────────────────────────────────────────────────────────────────────

import { ArrowLeft, Info, Send } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
  DfStatCard,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";
import { requireModuleAdmin } from "@/lib/auth/module-access";
import { ConnectTelegramButton } from "@/components/telegram/connect-telegram-button";

export const dynamic = "force-dynamic";

const STEPS = [
  "เปิดแอป Telegram บนมือถือหรือคอมพิวเตอร์ (ถ้ายังไม่มี โหลดได้ทั้ง iOS/Android)",
  'กดปุ่ม "เชื่อมบัญชี Telegram" ด้านล่างในหน้านี้ (หรือที่หน้าโปรไฟล์ของตัวเอง)',
  'กดปุ่ม "เปิดใน Telegram เพื่อเชื่อมบัญชี" ที่ขึ้นมา — แอป Telegram จะเปิดแชทกับบอทให้อัตโนมัติ',
  'กด "START" หรือส่งข้อความในแชทนั้น (ระบบเติมให้อัตโนมัติ)',
  "เสร็จแล้ว! บอทจะตอบกลับว่าเชื่อมสำเร็จ — จากนี้มีเอกสารให้เซ็นเมื่อไหร่ จะได้รับ Telegram แจ้งเตือนทันที พร้อมปุ่มกดดูเอกสาร",
];

export default async function DocuFlowTelegramSettingsPage() {
  const session = await requireSession();
  await requireModuleAdmin(session.user, "docuflow");
  const orgId = session.user.org_id;

  const [totalActive, connectedCount] = await Promise.all([
    prisma.user.count({ where: { orgId, isActive: true } }),
    prisma.user.count({
      where: { orgId, isActive: true, telegramChatId: { not: null } },
    }),
  ]);
  const notConnected = Math.max(totalActive - connectedCount, 0);
  const viewerConnected = !!session.user.telegram_chat_id;

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
          { label: "Telegram" },
        ]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>ตั้งค่า · Telegram</DfEyebrow>}
        title="แจ้งเตือนผ่าน Telegram"
        description="เชื่อมบัญชี Telegram เพื่อรับแจ้งเตือนทันทีที่มีเอกสารให้เซ็น — ฟรี ไม่มีค่าใช้จ่ายต่อข้อความ"
        actions={
          <DfButton href="/docuflow/settings" variant="ghost" size="sm">
            <ArrowLeft size={14} />
            กลับหน้าตั้งค่า
          </DfButton>
        }
      />

      <DfSection
        number="01"
        label="ภาพรวมองค์กร"
        title="ใครเชื่อมบัญชีแล้วบ้าง"
        className="df-fade-up df-fade-up-100"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          <DfStatCard
            label="เชื่อมบัญชีแล้ว"
            value={connectedCount}
            sub={`จากพนักงานที่ใช้งานอยู่ ${totalActive} คน`}
            tone="success"
            icon={<Send size={16} />}
          />
          <DfStatCard
            label="ยังไม่เชื่อม"
            value={notConnected}
            sub="จะไม่ได้รับแจ้งเตือนทาง Telegram จนกว่าจะเชื่อมบัญชี"
            tone="warn"
          />
        </div>
      </DfSection>

      <DfSection
        number="02"
        label="บัญชีของคุณ"
        title="เชื่อมบัญชี Telegram ของคุณเอง"
        className="df-fade-up df-fade-up-200"
      >
        <DfCard padding={18}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--df-ink)", marginBottom: 2 }}>
                {session.user.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--df-muted)" }}>
                {viewerConnected
                  ? "บัญชีนี้เชื่อม Telegram แล้ว — จะได้รับแจ้งเตือนเอกสารที่ต้องเซ็น"
                  : "ยังไม่เชื่อม — เชื่อมตอนนี้เพื่อทดสอบขั้นตอนด้วยบัญชีของคุณเอง"}
              </div>
            </div>
            <ConnectTelegramButton connected={viewerConnected} />
          </div>
        </DfCard>
      </DfSection>

      <DfSection
        number="03"
        label="วิธีเชื่อมบัญชี"
        description="ขั้นตอนเดียวกันนี้ใช้ได้กับพนักงานทุกคน — ส่งลิงก์หน้านี้หรือหน้าโปรไฟล์ให้พนักงานทำตามได้เลย"
        className="df-fade-up df-fade-up-300"
      >
        <DfCard padding={0} style={{ overflow: "hidden" }}>
          {STEPS.map((step, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 14,
                padding: "14px 20px",
                borderBottom: i < STEPS.length - 1 ? "1px solid var(--df-line-soft)" : "none",
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "var(--df-brand-soft)",
                  color: "var(--df-brand)",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <p style={{ fontSize: 13, color: "var(--df-ink-2)", margin: 0, lineHeight: 1.6 }}>
                {step}
              </p>
            </div>
          ))}
        </DfCard>
      </DfSection>

      <DfCard padding={16} warm style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Info size={16} style={{ color: "var(--df-muted)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12, color: "var(--df-ink-2)", lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>
            ตอนนี้แจ้งเตือนจะมีแค่ปุ่ม <DfPill tone="outline" small>📄 ดูเอกสาร</DfPill> ที่เปิดหน้าเซ็นเอกสารให้ทันที
            — ยังไม่มีปุ่ม &quot;เซ็นด้วยลายเซ็นที่บันทึกไว้&quot; จากใน Telegram โดยตรง เพราะต้องตรวจสอบตัวตนให้ปลอดภัยก่อน
            (เป็นแผนขั้นต่อไป)
          </p>
          <p style={{ margin: "6px 0 0" }}>
            คนที่ยังไม่เชื่อมบัญชี Telegram จะยังเห็นแจ้งเตือนในระบบตามปกติ (หน้า /docuflow/notifications) — Telegram เป็นช่องทางเสริม ไม่ใช่ช่องทางเดียว
          </p>
        </div>
      </DfCard>
    </div>
  );
}
