// LedgerLine — LINE slash/keyword commands (run inside the webhook).
//
// /help · วิธีใช้           → how-to (anyone)
// /menu · /guide            → same help
// /setting · /link          → admin only: show this group's branch binding + how to set
// /setting สาขา <code>      → bind THIS group ↔ a branch (group = branch auto-tag)
// /setting จ่าย <วิธี>       → set the group's default payment method
// /members · /สมาชิก         → admin only: list members + the branch each oversees
//
// Admin gate: the sender's LINE userId must map to a Pool user with admin-tier
// or accountant role (we never trust a raw LINE id for privileged actions).
// Returns a plain-text reply, or null if the text isn't a command.

import { prisma } from "@/lib/prisma";
import { isAdminTier } from "@/lib/auth/role-guards";

const PAYMENT_WORDS: Record<string, string> = {
  เงินสด: "cash", สด: "cash",
  โอน: "transfer", โอนเงิน: "transfer",
  คิวอาร์: "qr", qr: "qr", พร้อมเพย์: "qr",
  บัตร: "credit_card", บัตรเครดิต: "credit_card",
};

export interface CommandCtx {
  orgId: string;
  companyId: string;
  channelRowId: string;
  branchId: string | null;
  senderLineUserId: string | null;
}

const HELP = [
  "📒 วิธีใช้ LedgerLine ผ่าน LINE",
  "",
  "📷 ส่งรูปใบเสร็จ → ระบบอ่าน + ทำร่างให้ตรวจ",
  '⌨️ พิมพ์ "จด กาแฟ 45" → บันทึกรายจ่าย (ฟรี)',
  '❓ ถาม "สรุปเดือนนี้" / "หมวดไหนเยอะ" → ดูยอด',
  "✏️ แก้ไข/ยืนยัน ทำในเว็บหรือกดปุ่มบนการ์ด",
  '🏢 พิมพ์ "/สาขา ชุมพวง" → ขอดูแลสาขา (รอแอดมินอนุมัติ)',
  "",
  "⚙️ คำสั่งแอดมิน:",
  "• /จัดการ — เปิดหน้าจัดการทีม/สิทธิ์/สาขา (มือถือ)",
  "• /link (หรือ /setting) — ผูกกลุ่มนี้กับสาขา",
  "• /members — ดูว่าใครดูแลสาขาไหน",
].join("\n");

const MEMBER_ROLE_LABEL: Record<string, string> = {
  staff: "พนักงาน",
  accountant: "บัญชี",
  admin: "แอดมิน",
  external_accountant: "สนง.บัญชีภายนอก",
};

/** Build the LIFF admin-console deep link (opens /liff/ledger/admin inside LINE). */
function adminConsoleUrl(): string | null {
  const liffId = process.env.NEXT_PUBLIC_LEDGER_LIFF_ID;
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}?next=${encodeURIComponent("/liff/ledger/admin")}`;
}

/** Is this the `/setting`-able admin? (Pool user, admin-tier or accountant) */
async function isAdminSender(
  orgId: string,
  lineUserId: string | null,
): Promise<boolean> {
  if (!lineUserId) return false;
  const u = await prisma.user.findFirst({
    where: { lineUserId, orgId },
    select: { role: true },
  });
  if (!u) return false;
  return isAdminTier(u.role) || u.role === "viewer" || u.role === "area_manager";
}

export async function handleLedgerCommand(
  rawText: string,
  ctx: CommandCtx,
): Promise<string | null> {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  if (lower === "/help" || lower === "/menu" || lower === "/guide" || text === "วิธีใช้") {
    return HELP;
  }

  if (lower === "/support" || text === "แจ้งปัญหา") {
    return [
      "🛟 แจ้งปัญหา LedgerLine",
      "",
      "พิมพ์อาการที่เจอในแชตนี้ได้เลย แล้วแอดมินจะตามให้",
      "หรือทักแอดมินบัญชีของบริษัทโดยตรง",
      "",
      "เคล็ดลับ: ส่งรูปใบเสร็จที่มีปัญหามาด้วย จะช่วยให้แก้ได้ไวขึ้น 🙏",
    ].join("\n");
  }

  // จัดการ / /admin — เปิดหน้าจัดการทีม (LIFF console) — แอดมินเท่านั้น
  if (
    text === "จัดการ" ||
    text === "จัดการทีม" ||
    lower === "/admin" ||
    lower === "/console" ||
    lower === "/จัดการ"
  ) {
    if (!(await isAdminSender(ctx.orgId, ctx.senderLineUserId))) {
      return "เฉพาะแอดมินเท่านั้น · ถ้าต้องการสิทธิ์ ติดต่อผู้ดูแลของบริษัท";
    }
    const url = adminConsoleUrl();
    return [
      "🛠️ หน้าจัดการทีม (เปิดในมือถือ)",
      "",
      "จัดการสมาชิก · สาขา · สิทธิ์ · หมวด · ข้อมูลบริษัท ได้ในที่เดียว",
      "",
      url ? `เปิดที่นี่: ${url}` : "ยังไม่ได้ตั้งค่า LIFF · ติดต่อผู้ดูแลระบบ",
    ].join("\n");
  }

  // /members — ใครดูแลสาขาไหน (แอดมินเท่านั้น)
  if (lower === "/members" || lower === "/สมาชิก" || text === "สมาชิก") {
    if (!(await isAdminSender(ctx.orgId, ctx.senderLineUserId))) {
      return "เฉพาะแอดมิน/บัญชีที่ผูกบัญชีกับ LINE แล้วเท่านั้นที่ดูได้";
    }
    const members = await prisma.ledgerLineMember.findMany({
      where: { orgId: ctx.orgId, companyId: ctx.companyId, active: true },
      select: { displayName: true, role: true, scopeBranchIds: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    if (!members.length) {
      return [
        "👥 ยังไม่มีสมาชิกที่ผูกบัญชี",
        "",
        "เชิญคนเข้าระบบ + กำหนดสาขาที่ดูแลได้ที่หน้าเว็บ",
        "ตั้งค่า → คำเชิญ (สร้างลิงก์เชิญแบบระบุสาขา)",
      ].join("\n");
    }
    // resolve branch names ทีเดียว (กันยิง N+1)
    const branchIds = Array.from(new Set(members.flatMap((m) => m.scopeBranchIds)));
    const branches = branchIds.length
      ? await prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(branches.map((b) => [b.id, b.name]));
    const lines = members.map((m) => {
      const who = m.displayName?.trim() || "(ไม่มีชื่อ)";
      const role = MEMBER_ROLE_LABEL[m.role] ?? m.role;
      const scope = m.scopeBranchIds.length
        ? m.scopeBranchIds.map((id) => nameById.get(id) ?? "?").join(", ")
        : "ทุกสาขา/ยังไม่กำหนด";
      return `• ${who} · ${role}\n   ดูแล: ${scope}`;
    });
    return ["👥 สมาชิกและสาขาที่ดูแล", "", ...lines, "", "กำหนด/เปลี่ยนสาขาได้ในเว็บ → ตั้งค่า"].join("\n");
  }

  // /สาขา <ชื่อ/รหัส> — สมาชิกขอดูแลสาขานี้เอง (รออนุมัติจากแอดมินในเว็บ).
  // ไม่ต้องเป็นแอดมิน · ใครก็ขอได้ · ผลคือ pendingBranchId รออนุมัติ (ไม่ผูกทันที).
  if (lower === "/สาขา" || lower === "/branch" || text === "เปลี่ยนสาขา") {
    return [
      "🏢 ขอดูแลสาขา",
      "",
      'พิมพ์  /สาขา <ชื่อสาขา>  เช่น "/สาขา ชุมพวง"',
      "ระบบจะส่งคำขอให้แอดมินอนุมัติก่อน",
    ].join("\n");
  }
  const branchReq = text.match(/^\/(?:สาขา|branch)\s+(.+)$/i);
  if (branchReq) {
    if (!ctx.senderLineUserId) {
      return "ระบุตัวตนไม่ได้ · ลองทักบอทในแชตส่วนตัวแล้วพิมพ์อีกครั้ง";
    }
    const code = branchReq[1].trim();
    const branch = await prisma.branch.findFirst({
      where: {
        orgId: ctx.orgId,
        companyId: ctx.companyId,
        OR: [
          { code: { equals: code, mode: "insensitive" } },
          { name: { contains: code, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true },
    });
    if (!branch) return `ไม่พบสาขา "${code}" · ลองพิมพ์ชื่อให้ตรงขึ้น`;
    await prisma.ledgerLineMember.upsert({
      where: { orgId_lineUserId: { orgId: ctx.orgId, lineUserId: ctx.senderLineUserId } },
      update: { pendingBranchId: branch.id },
      create: {
        orgId: ctx.orgId,
        companyId: ctx.companyId,
        lineUserId: ctx.senderLineUserId,
        role: "staff",
        scopeBranchIds: [],
        scopeCategoryIds: [],
        pendingBranchId: branch.id,
      },
    });
    return `📩 ส่งคำขอดูแลสาขา "${branch.name}" แล้ว · รอแอดมินอนุมัติในระบบ`;
  }

  if (
    lower === "/setting" ||
    lower === "/link" ||
    lower === "/เชื่อม" ||
    text.startsWith("/setting ") ||
    lower.startsWith("/link ") ||
    text.startsWith("/ตั้งค่า") ||
    text.startsWith("/เชื่อม ")
  ) {
    if (!(await isAdminSender(ctx.orgId, ctx.senderLineUserId))) {
      return "เฉพาะแอดมิน/บัญชีที่ผูกบัญชีกับ LINE แล้วเท่านั้นที่ตั้งค่าได้ · หรือกำหนดสาขาให้กลุ่มนี้ได้ในเว็บ → ตั้งค่า";
    }
    const arg = text.replace(/^\/(setting|ตั้งค่า|link|เชื่อม)\s*/i, "").trim();

    // /setting สาขา <code>
    const branchMatch = arg.match(/^(?:สาขา|branch)\s+(.+)$/i);
    if (branchMatch) {
      const code = branchMatch[1].trim();
      const branch = await prisma.branch.findFirst({
        where: {
          orgId: ctx.orgId,
          companyId: ctx.companyId,
          OR: [{ code: { equals: code, mode: "insensitive" } }, { name: { contains: code, mode: "insensitive" } }],
        },
        select: { id: true, code: true, name: true },
      });
      if (!branch) return `ไม่พบสาขา "${code}" · พิมพ์ /setting เพื่อดูรายการสาขา`;
      await prisma.ledgerLineChannel.update({
        where: { id: ctx.channelRowId },
        data: { branchId: branch.id, kind: "branch" },
      });
      return `✅ ผูกกลุ่มนี้กับสาขา "${branch.name}" แล้ว · รายจ่ายในกลุ่มนี้จะลงสาขานี้อัตโนมัติ`;
    }

    // /setting จ่าย <วิธี>
    const payMatch = arg.match(/^(?:จ่าย|payment|วิธีจ่าย)\s+(.+)$/i);
    if (payMatch) {
      const w = payMatch[1].trim().toLowerCase();
      const method = PAYMENT_WORDS[w] ?? PAYMENT_WORDS[payMatch[1].trim()] ?? null;
      if (!method) return "วิธีจ่ายที่รองรับ: เงินสด · โอน · คิวอาร์ · บัตร";
      await prisma.ledgerLineChannel.update({
        where: { id: ctx.channelRowId },
        data: { defaultPaymentMethod: method },
      });
      return `✅ ตั้งวิธีจ่ายเริ่มต้นของกลุ่มเป็น "${payMatch[1].trim()}" แล้ว`;
    }

    // bare /setting → status + how-to + branch list
    const branches = await prisma.branch.findMany({
      where: { orgId: ctx.orgId, companyId: ctx.companyId, isActive: true },
      select: { code: true, name: true },
      orderBy: { code: "asc" },
      take: 30,
    });
    let bound = "ยังไม่ผูกสาขา (เป็นกลุ่มกลาง — ระบุสาขาทีหลังได้)";
    if (ctx.branchId) {
      const b = await prisma.branch.findUnique({ where: { id: ctx.branchId }, select: { name: true } });
      if (b) bound = `ผูกกับสาขา: ${b.name}`;
    }
    const list = branches.length
      ? branches.map((b) => `• ${b.code} — ${b.name}`).join("\n")
      : "(ยังไม่มีสาขาในบริษัทนี้)";
    return [
      "⚙️ ตั้งค่ากลุ่ม LINE นี้",
      bound,
      "",
      'ผูกสาขา: พิมพ์  /setting สาขา <รหัสสาขา>',
      'ตั้งวิธีจ่าย: พิมพ์  /setting จ่าย โอน',
      ...(adminConsoleUrl()
        ? ["", `🛠️ จัดการทีม/สิทธิ์/สาขาแบบเต็ม: ${adminConsoleUrl()}`]
        : []),
      "",
      "สาขาที่มี:",
      list,
    ].join("\n");
  }

  return null; // not a command
}
