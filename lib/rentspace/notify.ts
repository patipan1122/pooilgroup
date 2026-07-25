// แจ้งเตือนผู้เช่าว่ามีการวางบิล — LINE push (ถ้าเชื่อม LINE) + อีเมล (ถ้าเปิดรับ)
// best-effort · ไม่ throw (แจ้งเตือนล้มไม่ควรบล็อกการออกบิล) · dormant ถ้าไม่มีกุญแจ LINE/Resend
import { prisma } from "@/lib/prisma";
import { toNum, periodLabel, tenantDisplayName } from "@/lib/rentspace/format";
import { rentspacePushMessages } from "@/lib/rentspace/line";
import { sendRentspaceEmail } from "@/lib/rentspace/email";
import { ensurePortalToken, portalUrl } from "@/lib/rentspace/portal";
import { getBaseUrl } from "@/lib/utils/base-url";

const baht = (n: number) => "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTH = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

export type BillNotifyResult = { channels: string[]; line?: string; email?: string };

/**
 * แจ้งเตือนผู้เช่าว่ามีการวางบิล.
 * ลิงก์ในข้อความ = พอร์ทัลผู้เช่า (ออกให้อัตโนมัติถ้ายังไม่มี) → เห็นทุกบิล + จ่าย+แนบสลิปได้.
 * คืน channels ที่ส่งสำเร็จ เพื่อบันทึกเป็น sentChannel ("line" / "email" / "line+email" / -).
 */
export async function notifyBillIssued(billId: string): Promise<BillNotifyResult> {
  const channels: string[] = [];
  const out: BillNotifyResult = { channels };
  try {
    const bill = await prisma.rentalBill.findUnique({
      where: { id: billId },
      include: { tenant: true, project: true, unit: true },
    });
    if (!bill || !bill.tenant) return out;

    const tenant = bill.tenant;
    const total = toNum(bill.totalAmount);
    const outstanding = Math.max(0, total - toNum(bill.paidAmount));
    const amountShown = outstanding > 0 ? outstanding : total;
    const projectName = bill.project?.name ?? "";
    const period = periodLabel(bill.period);
    const due = dateTH(new Date(bill.dueDate));

    // ลิงก์: พอร์ทัล (เห็นทุกบิล+จ่าย) ถ้าออกได้ · ไม่งั้น fallback หน้าบิลใบนี้
    const pToken = await ensurePortalToken(tenant.id);
    const link = pToken
      ? portalUrl(pToken)
      : bill.publicToken
        ? `${getBaseUrl().replace(/\/$/, "")}/rentspace/bill/${bill.publicToken}`
        : "";

    // LINE push
    if (tenant.lineUserId) {
      const text =
        `📄 มีใบแจ้งหนี้ใหม่\n` +
        `${projectName}${bill.unit?.code ? ` · ห้อง ${bill.unit.code}` : ""}\n` +
        `งวด ${period} · ยอด ${baht(amountShown)}\n` +
        `ครบกำหนด ${due}` +
        (link ? `\n\nดูบิล + แจ้งชำระเงิน:\n${link}` : "");
      const r = await rentspacePushMessages(tenant.lineUserId, [{ type: "text", text }]);
      out.line = r.ok ? "sent" : r.skipped ? "skipped" : `fail:${r.error ?? ""}`;
      if (r.ok) channels.push("line");
    } else {
      out.line = "no-link";
    }

    // Email
    if (tenant.emailBillOptIn && tenant.email) {
      const subject = `ใบแจ้งหนี้ ${projectName} งวด ${period}`;
      const text =
        `เรียน ${tenantDisplayName(tenant)}\n\n` +
        `มีใบแจ้งหนี้ใหม่สำหรับ ${projectName}${bill.unit?.code ? ` ห้อง ${bill.unit.code}` : ""}\n` +
        `งวด ${period}\nยอดชำระ ${baht(amountShown)}\nครบกำหนด ${due}\n` +
        (link ? `\nดูบิลและแจ้งชำระเงินได้ที่:\n${link}\n` : "") +
        `\nขอบคุณครับ`;
      const r = await sendRentspaceEmail({ to: tenant.email, subject, text });
      out.email = r.sent ? "sent" : r.skipped ? "skipped" : `fail:${r.error ?? ""}`;
      if (r.sent) channels.push("email");
    } else {
      out.email = "opt-out";
    }
  } catch (e) {
    console.error("[rentspace-notify] error", e);
  }
  return out;
}
