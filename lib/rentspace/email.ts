// RentSpace — ส่งอีเมล (Resend) · dormant-safe: no-op ถ้าไม่มี RESEND_API_KEY · ไม่ throw
// FROM ต้องเป็นโดเมนที่ verify ใน Resend แล้ว (ตั้งทับด้วย env RENTSPACE_MAIL_FROM ได้)
const FROM = process.env.RENTSPACE_MAIL_FROM ?? "เจพีซิ้งค์ แจ้งค่าเช่า <noreply@pooilgroup.com>";

export async function sendRentspaceEmail(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!args.to) return { sent: false, error: "no_email" };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, skipped: true, error: "no_api_key" }; // หลับรอจนกว่าจะเปิด Resend

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [args.to], subject: args.subject, text: args.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[rentspace-email] resend error", res.status, (await res.text()).slice(0, 200));
      return { sent: false, error: `resend_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("[rentspace-email] send fail", e);
    return { sent: false, error: "exception" };
  }
}
