// Recruit — email notifications (Resend)
// CEO Q4: ส่งให้ผู้สมัครอัตโนมัติเมื่อ status เปลี่ยน

import type { ApplicationStatus } from "./types";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://pooilgroup.vercel.app";
const FROM = "Pooilgroup HR <noreply@pooilgroup.vercel.app>";

export const STATUS_EMAIL_TEMPLATES: Record<
  ApplicationStatus,
  { subject: string; body: (ctx: EmailCtx) => string } | null
> = {
  NEW: {
    subject: "ได้รับใบสมัคร {position} เรียบร้อย",
    body: (ctx) =>
      `สวัสดี ${ctx.applicantName}\n\nเราได้รับใบสมัครของคุณสำหรับตำแหน่ง "${ctx.position}" เรียบร้อยแล้ว\nเลขที่ใบสมัคร: ${ctx.refId}\n\nทีมเราจะพิจารณาและติดต่อกลับโดยเร็ว\n\nขอบคุณ\nทีม HR ${ctx.company}`,
  },
  SCREENING: {
    subject: "ใบสมัคร {refId} อยู่ระหว่างพิจารณา",
    body: (ctx) =>
      `สวัสดี ${ctx.applicantName}\n\nใบสมัครของคุณสำหรับตำแหน่ง "${ctx.position}" อยู่ระหว่างคัดกรอง\nเลขที่: ${ctx.refId}\n\nหากผ่านการคัดกรองเบื้องต้น เราจะนัดสัมภาษณ์โดยเร็ว\n\nขอบคุณ\nทีม HR ${ctx.company}`,
  },
  INTERVIEW: {
    subject: "เชิญสัมภาษณ์ตำแหน่ง {position}",
    body: (ctx) =>
      `สวัสดี ${ctx.applicantName}\n\nยินดีด้วย ใบสมัคร ${ctx.refId} ของคุณได้รับการพิจารณาเข้าสู่ขั้นตอนสัมภาษณ์\nตำแหน่ง: "${ctx.position}"\n\nทีม HR จะติดต่อกลับเพื่อนัดเวลาสัมภาษณ์ในเร็ว ๆ นี้\n\nขอบคุณ\nทีม HR ${ctx.company}`,
  },
  OFFERED: {
    subject: "ข้อเสนองาน — ${position}",
    body: (ctx) =>
      `สวัสดี ${ctx.applicantName}\n\nเรายินดียื่นข้อเสนอตำแหน่ง "${ctx.position}" ให้คุณ\nเลขที่ใบสมัคร: ${ctx.refId}\n\nทีม HR จะติดต่อกลับเพื่อหารือรายละเอียดเงินเดือนและเงื่อนไข\n\nขอบคุณ\nทีม HR ${ctx.company}`,
  },
  HIRED: {
    subject: "ยินดีต้อนรับสู่ ${company}",
    body: (ctx) =>
      `สวัสดี ${ctx.applicantName}\n\nยินดีต้อนรับสู่ ${ctx.company}!\nคุณได้รับการรับเข้าทำงานในตำแหน่ง "${ctx.position}"\n\nทีม HR จะติดต่อกลับเพื่อนัดวันเริ่มงาน และเอกสารที่ต้องเตรียม\n\nขอบคุณ\nทีม HR ${ctx.company}`,
  },
  REJECTED: {
    subject: "ขอบคุณที่สนใจตำแหน่ง ${position}",
    body: (ctx) =>
      `สวัสดี ${ctx.applicantName}\n\nขอบคุณที่ส่งใบสมัครตำแหน่ง "${ctx.position}" มาให้เรา\nหลังพิจารณาอย่างละเอียด เราขอแจ้งว่าครั้งนี้เรายังไม่เลือกใบสมัคร ${ctx.refId} ของคุณ\n\nเราจะเก็บข้อมูลของคุณไว้พิจารณาตำแหน่งอื่นที่เหมาะสมในอนาคต\n\nขอบคุณ\nทีม HR ${ctx.company}`,
  },
  WITHDRAWN: null,
};

export interface EmailCtx {
  applicantName: string;
  applicantEmail: string;
  position: string;
  refId: string;
  company: string;
}

/**
 * Send notification email. No-op if RESEND_API_KEY missing (dev mode).
 * Logs errors but does NOT throw — email failure shouldn't block status change.
 */
export async function sendStatusEmail(
  status: ApplicationStatus,
  ctx: EmailCtx,
): Promise<{ sent: boolean; error?: string }> {
  const template = STATUS_EMAIL_TEMPLATES[status];
  if (!template) return { sent: false };
  if (!ctx.applicantEmail) return { sent: false, error: "no_email" };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // P2-13: silent no-op in dev is fine · but in prod = real bug · scream loud.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[recruit-email] FATAL · RESEND_API_KEY missing in production · email NOT sent:",
        template.subject,
      );
      return { sent: false, error: "no_api_key_prod" };
    }
    console.log(
      "[recruit-email] RESEND_API_KEY missing (dev) · would send:",
      template.subject.replace(/\{(\w+)\}/g, (_, k) => String(ctx[k as keyof EmailCtx] ?? "")),
    );
    return { sent: false, error: "no_api_key" };
  }

  const subject = template.subject.replace(
    /\{(\w+)\}/g,
    (_, k) => String(ctx[k as keyof EmailCtx] ?? ""),
  );
  const body = template.body(ctx);

  try {
    // B-002: explicit timeout to prevent hang if Resend is slow/down
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [ctx.applicantEmail],
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[recruit-email] resend error", res.status, err);
      return { sent: false, error: `resend_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("[recruit-email] send fail", e);
    return { sent: false, error: "exception" };
  }
}

export function applicantLandingUrl(slug: string): string {
  return `${APP_URL}/apply/${slug}`;
}
