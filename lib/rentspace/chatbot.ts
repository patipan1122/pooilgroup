// Chatbot ตอบลูกค้าใน LINE OA พื้นที่เช่า — ตอบจากข้อมูลบิลจริงของผู้เช่า + AI (Gemini)
// reuse aiAnswer (มี budget guard + กัน prompt-injection) · reply ฟรีไม่กินโควตา
import { prisma } from "@/lib/prisma";
import { toNum, periodLabel, tenantDisplayName } from "@/lib/rentspace/format";
import { aiAnswer } from "@/lib/inbox/bot/ai";
import { ensurePortalToken, portalUrl } from "@/lib/rentspace/portal";

const baht = (n: number) => "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTH = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

/**
 * ตอบข้อความลูกค้า (ผู้เช่า) — ระบุตัวตนจาก lineUserId → ดึงบิลจริง → ให้ AI ตอบจากข้อมูลนั้น.
 * ถ้ายังไม่เชื่อม LINE → แนะนำให้กดลิงก์เชิญ · ถ้า AI ตอบไม่ได้/ไม่มี key → fallback สรุปยอด+ลิงก์.
 */
export async function rentspaceBotReply(lineUserId: string, text: string): Promise<string> {
  const tenant = await prisma.rentalTenant.findUnique({ where: { lineUserId } });
  if (!tenant || !tenant.isActive) {
    return (
      "สวัสดีครับ 🙏 บัญชี LINE นี้ยังไม่ได้เชื่อมกับข้อมูลผู้เช่า\n" +
      'กรุณากดลิงก์เชิญที่ได้รับจากเจ้าหน้าที่ แล้วกด "เชื่อม LINE" เพื่อดูใบแจ้งหนี้และสอบถามได้ครับ'
    );
  }

  const bills = await prisma.rentalBill.findMany({
    where: { tenantId: tenant.id, orgId: tenant.orgId, status: { notIn: ["void", "draft"] } },
    orderBy: [{ period: "desc" }],
    include: { unit: true, project: true },
    take: 12,
  });
  const outstanding = bills.filter((b) => toNum(b.totalAmount) - toNum(b.paidAmount) > 0);
  const totalOut = outstanding.reduce((s, b) => s + Math.max(0, toNum(b.totalAmount) - toNum(b.paidAmount)), 0);
  const pToken = await ensurePortalToken(tenant.id);
  const link = pToken ? portalUrl(pToken) : "";
  const projectName = bills[0]?.project?.name ?? "พื้นที่เช่า";

  const knowledge = [
    `ผู้เช่า: ${tenantDisplayName(tenant)}`,
    bills[0]?.unit?.code ? `ห้อง: ${bills[0].unit.code}` : "",
    `โครงการ: ${projectName}`,
    `ยอดค้างชำระรวมทั้งหมด: ${baht(totalOut)} (${outstanding.length} ใบ)`,
    outstanding.length
      ? "รายละเอียดบิลค้าง:\n" +
        outstanding
          .map(
            (b) =>
              `- งวด ${periodLabel(b.period)} ยอด ${baht(Math.max(0, toNum(b.totalAmount) - toNum(b.paidAmount)))} ครบกำหนด ${dateTH(new Date(b.dueDate))}`,
          )
          .join("\n")
      : "ไม่มีบิลค้างชำระ",
    link ? `ลิงก์ดูบิลทั้งหมด + แจ้งชำระเงิน (แนบสลิป): ${link}` : "",
    'วิธีชำระเงิน: เปิดลิงก์ด้านบน → เลือกบิล → กด "แจ้งชำระเงิน" → กรอกยอด+วันโอน → แนบสลิป → เจ้าหน้าที่จะตรวจและยืนยัน',
    "หากต้องการติดต่อเจ้าหน้าที่โดยตรง ให้แจ้งว่าต้องการให้ติดต่อกลับ",
  ]
    .filter(Boolean)
    .join("\n");

  const ai = await aiAnswer({
    text,
    knowledge,
    tone: "สุภาพ เป็นกันเอง กระชับ",
    businessName: projectName,
    orgId: tenant.orgId,
  });
  if (ai.answer && !ai.escalate) return ai.answer;

  // fallback: AI ตอบไม่ได้ / ไม่มี GEMINI_API_KEY / เกินงบ → สรุปยอด + ลิงก์
  const head = outstanding.length
    ? `คุณมียอดค้างชำระ ${baht(totalOut)} (${outstanding.length} ใบ)`
    : "ตอนนี้ไม่มียอดค้างชำระครับ ✅";
  return (
    `${head}` +
    (link ? `\n\nดูบิลทั้งหมด + แจ้งชำระเงินได้ที่:\n${link}` : "") +
    "\n\nสอบถามเพิ่มเติมได้เลยครับ หรือถ้าต้องการให้เจ้าหน้าที่ติดต่อกลับ แจ้งได้ครับ 🙏"
  );
}
