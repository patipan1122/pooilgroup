// LedgerLine — LINE slash/keyword commands (run inside the webhook).
//
// /help · วิธีใช้           → how-to (anyone)
// /menu · /guide            → same help
// /setting · /link          → admin only: show this group's branch binding + how to set
// /setting สาขา <code>      → bind THIS group ↔ a branch (group = branch auto-tag)
// /setting จ่าย <วิธี>       → set the group's default payment method
// /setting สลิป [เปิด|ปิด]   → admin only: make THIS group a "slip-intake" group
//                              (images = payment slips → QR dedup + AI amount +
//                              auto-match an unpaid bill). No web / no LIFF needed.
// /members · /สมาชิก         → admin only: list members + the branch each oversees
//
// Admin gate: the sender's LINE userId must map to a Pool user with admin-tier
// or accountant role (we never trust a raw LINE id for privileged actions).
// Returns a plain-text reply, or null if the text isn't a command.

import { prisma } from "@/lib/prisma";
import { isAdminTier } from "@/lib/auth/role-guards";
import { getLedgerDriveFolderLink } from "@/lib/ledger/drive";
import { refreshLedgerGroupMeta } from "@/lib/ledger/line-group";

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
  /** The LINE group this command came from (null in 1:1). Drives per-group
   *  branch binding (B3 multi-group): /setting สาขา in a group pins THAT group. */
  groupId: string | null;
  senderLineUserId: string | null;
  /** Channel access token — lets /setting fetch the group's real name + member
   *  count from the LINE API and snapshot them (best-effort). Omit in 1:1. */
  accessToken?: string | null;
}

const HELP = [
  "📒 วิธีใช้ LedgerLine ผ่าน LINE",
  "",
  "📷 ส่งรูปใบเสร็จ → ระบบอ่าน + ทำร่างให้ตรวจ",
  '⌨️ พิมพ์ "จด กาแฟ 45" → บันทึกรายจ่าย (ฟรี)',
  '❓ ถาม "สรุปเดือนนี้" / "หมวดไหนเยอะ" → ดูยอด',
  "✏️ แก้ไข/ยืนยัน ทำในเว็บหรือกดปุ่มบนการ์ด",
  "📁 ดูไฟล์ใบเสร็จจริงใน Google Drive → พิมพ์ /drive",
  '🏢 พิมพ์ "/สาขา ชุมพวง" → ขอดูแลสาขา (รอแอดมินอนุมัติ)',
  "",
  "⚙️ คำสั่งแอดมิน:",
  "• /จัดการ — เปิดหน้าจัดการทีม/สิทธิ์/สาขา (มือถือ)",
  "• /link (หรือ /setting) — ผูกกลุ่มนี้กับสาขา",
  "• /setting สลิป — ตั้งกลุ่มนี้เป็น 'กลุ่มส่งสลิป' 💸",
  "• /members — ดูว่าใครดูแลสาขาไหน",
  "• /drive — ลิงก์โฟลเดอร์ Google Drive (หลักฐานให้สำนักงานบัญชี)",
].join("\n");

const MEMBER_ROLE_LABEL: Record<string, string> = {
  staff: "พนักงาน",
  accountant: "บัญชี",
  admin: "แอดมิน",
  external_accountant: "สนง.บัญชีภายนอก",
};

/** Build the LIFF admin-console deep link (opens /liff/ledger/admin inside LINE).
 *  LINE "Concatenate" rule: path after the LIFF id is appended to the FULL endpoint
 *  (/liff/ledger). A `/ledger` segment here would DUPLICATE it → /liff/ledger/ledger
 *  → 404. So NO path; pass the target in ?next= and the bootstrap navigates there. */
function adminConsoleUrl(): string | null {
  const liffId = process.env.NEXT_PUBLIC_LEDGER_LIFF_ID;
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}?next=${encodeURIComponent("/liff/ledger/admin")}`;
}

/** Is this sender a ledger ADMIN in chat? Pool admin-tier / accountant (viewer) /
 *  area_manager OR a person whose LEDGER member role is 'admin' (top-down promoted).
 *  Unified with the LIFF/web admin notion (audit 2026-06-05). */
async function isAdminSender(
  orgId: string,
  lineUserId: string | null,
): Promise<boolean> {
  if (!lineUserId) return false;
  const u = await prisma.user.findFirst({
    where: { lineUserId, orgId },
    select: { role: true },
  });
  if (u && (isAdminTier(u.role) || u.role === "viewer" || u.role === "area_manager")) {
    return true;
  }
  // Top-down ledger admin: a member explicitly set to role 'admin' (not necessarily
  // a Pool admin) may run admin commands in chat too.
  const m = await prisma.ledgerLineMember.findUnique({
    where: { orgId_lineUserId: { orgId, lineUserId } },
    select: { role: true, active: true },
  });
  return !!m && m.active && m.role === "admin";
}

/** Stricter than isAdminSender: who may pull ALL-company financial EVIDENCE (Drive
 *  folder, full P&L). Admin + accountant ONLY — a branch manager (area_manager)
 *  oversees one area and must NOT pull the whole company's receipts (audit P2 #11). */
async function senderSeesAllFinancials(
  orgId: string,
  lineUserId: string | null,
): Promise<boolean> {
  if (!lineUserId) return false;
  const u = await prisma.user.findFirst({
    where: { lineUserId, orgId },
    select: { role: true },
  });
  if (u && (isAdminTier(u.role) || u.role === "viewer")) return true;
  const m = await prisma.ledgerLineMember.findUnique({
    where: { orgId_lineUserId: { orgId, lineUserId } },
    select: { role: true, active: true },
  });
  return !!m && m.active && (m.role === "admin" || m.role === "accountant");
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

  // /drive — ลิงก์โฟลเดอร์ Google Drive ที่เก็บใบเสร็จจริง (หลักฐานให้สำนักงานบัญชี).
  // แอดมินเท่านั้น (โฟลเดอร์รวมทุกใบ); ลิงก์เปิดได้ต่อเมื่อมีสิทธิ์ใน Google Drive อยู่แล้ว.
  if (lower === "/drive" || text === "ไดรฟ์" || text === "ดูไฟล์" || text === "ดูสลิป") {
    if (!(await senderSeesAllFinancials(ctx.orgId, ctx.senderLineUserId))) {
      return "เฉพาะผู้ดูแล/บัญชีดูลิงก์ Google Drive ได้ · ขอลิงก์จากผู้ดูแลของบริษัท";
    }
    const link = await getLedgerDriveFolderLink(ctx.orgId);
    if (!link) {
      return [
        "📁 Google Drive ยังไม่ได้เชื่อม",
        "",
        "ให้แอดมินเชื่อม Google Drive ก่อน (หน้า ChairOps → ตั้งค่า → เชื่อม Google Drive)",
        "พอเชื่อมแล้ว ทุกใบเสร็จจะถูกเก็บเข้า Drive อัตโนมัติ แยกเป็น เดือน/ธุรกิจ/สาขา/ประเภท",
      ].join("\n");
    }
    return [
      "📁 ไฟล์ใบเสร็จทั้งหมดใน Google Drive",
      "เก็บแยก: เดือน → ธุรกิจ → สาขา → ประเภท",
      "",
      `เปิดที่นี่: ${link}`,
      "",
      "ส่งลิงก์นี้ให้สำนักงานบัญชีได้เลย 🧾",
    ].join("\n");
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
      if (ctx.groupId) {
        // Multi-group (B3): pin THIS LINE group → this branch. Each branch group
        // binds its own branch; the webhook reads this override per incoming group,
        // so one OA can serve many branches at once.
        await prisma.ledgerLineGroup.upsert({
          where: {
            orgId_companyId_groupId: {
              orgId: ctx.orgId,
              companyId: ctx.companyId,
              groupId: ctx.groupId,
            },
          },
          update: { branchId: branch.id, active: true },
          create: {
            orgId: ctx.orgId,
            companyId: ctx.companyId,
            groupId: ctx.groupId,
            branchId: branch.id,
          },
        });
        // Snapshot the group's real name + member count so the web list shows
        // "ชื่อกลุ่มจริง · N คน" instead of an id tail (best-effort).
        if (ctx.accessToken) {
          await refreshLedgerGroupMeta({
            orgId: ctx.orgId,
            companyId: ctx.companyId,
            groupId: ctx.groupId,
            accessToken: ctx.accessToken,
          });
        }
      } else {
        // 1:1 / no group context → set the channel's default branch (unchanged).
        await prisma.ledgerLineChannel.update({
          where: { id: ctx.channelRowId },
          data: { branchId: branch.id, kind: "branch" },
        });
      }
      return `✅ ผูกกลุ่มนี้กับสาขา "${branch.name}" แล้ว · รายจ่ายในกลุ่มนี้จะลงสาขานี้อัตโนมัติ`;
    }

    // /setting สลิป [เปิด|ปิด] — ตั้ง/ปิด "กลุ่มส่งสลิป" จากใน LINE โดยตรง (ไม่ต้องเข้าเว็บ).
    // เปิด = รูปทุกใบในกลุ่มนี้ถือเป็น "สลิปจ่ายเงิน" → อ่าน QR กันจ่ายซ้ำ + AI อ่านยอด → จับคู่บิล.
    const slipMatch = arg.match(/^(?:สลิป|slip)\s*(.*)$/i);
    if (slipMatch) {
      if (!ctx.groupId) {
        return "ตั้งกลุ่มส่งสลิปได้เฉพาะ 'ในกลุ่ม LINE' เท่านั้น · เข้าไปในกลุ่มที่จะใช้ส่งสลิป แล้วพิมพ์ /setting สลิป";
      }
      const w = slipMatch[1].trim().toLowerCase();
      const turnOff = ["ปิด", "off", "ยกเลิก", "เลิก", "0", "false"].includes(w);
      // The group must be bound to a branch first (the upsert key needs a row).
      const existing = await prisma.ledgerLineGroup.findFirst({
        where: { orgId: ctx.orgId, companyId: ctx.companyId, groupId: ctx.groupId },
        select: { id: true },
      });
      if (!existing) {
        return [
          "ยังตั้งกลุ่มส่งสลิปไม่ได้ — กลุ่มนี้ยังไม่ผูกสาขา",
          "",
          "พิมพ์  /setting สาขา <รหัสสาขา>  ก่อน แล้วค่อยพิมพ์  /setting สลิป",
        ].join("\n");
      }
      await prisma.ledgerLineGroup.update({
        where: { id: existing.id },
        data: { isSlipIntake: !turnOff, active: true },
      });
      if (ctx.accessToken) {
        await refreshLedgerGroupMeta({
          orgId: ctx.orgId,
          companyId: ctx.companyId,
          groupId: ctx.groupId,
          accessToken: ctx.accessToken,
        });
      }
      return turnOff
        ? "✅ ปิดโหมดกลุ่มส่งสลิปแล้ว · รูปในกลุ่มนี้จะถือเป็นใบเสร็จตามปกติ"
        : [
            "✅ ตั้งกลุ่มนี้เป็น 'กลุ่มส่งสลิป' แล้ว 💸",
            "",
            "รูปทุกใบที่ส่งในกลุ่มนี้ = สลิปจ่ายเงิน",
            "ระบบจะอ่าน QR กันจ่ายซ้ำ + AI อ่านยอด แล้วจับคู่บิลที่ยังไม่จ่ายให้อัตโนมัติ",
            "",
            "ปิดโหมดนี้: พิมพ์  /setting สลิป ปิด",
          ].join("\n");
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
    let slipLine: string | null = null;
    // Prefer this group's own binding (B3); fall back to the channel default.
    let boundBranchId = ctx.branchId;
    if (ctx.groupId) {
      const gm = await prisma.ledgerLineGroup.findFirst({
        where: { orgId: ctx.orgId, companyId: ctx.companyId, groupId: ctx.groupId, active: true },
        select: { branchId: true, isSlipIntake: true },
      });
      if (gm?.branchId) boundBranchId = gm.branchId;
      slipLine = gm?.isSlipIntake
        ? "💸 กลุ่มส่งสลิป: เปิดอยู่ (รูป = สลิปจ่ายเงิน)"
        : "💸 กลุ่มส่งสลิป: ปิด · เปิดด้วย /setting สลิป";
      // Refresh this group's name + member count while the admin is configuring.
      if (ctx.accessToken) {
        await refreshLedgerGroupMeta({
          orgId: ctx.orgId,
          companyId: ctx.companyId,
          groupId: ctx.groupId,
          accessToken: ctx.accessToken,
        });
      }
    }
    if (boundBranchId) {
      const b = await prisma.branch.findUnique({ where: { id: boundBranchId }, select: { name: true } });
      if (b) bound = `ผูกกับสาขา: ${b.name}`;
    }
    const list = branches.length
      ? branches.map((b) => `• ${b.code} — ${b.name}`).join("\n")
      : "(ยังไม่มีสาขาในบริษัทนี้)";
    return [
      "⚙️ ตั้งค่ากลุ่ม LINE นี้",
      bound,
      ...(slipLine ? [slipLine] : []),
      "",
      'ผูกสาขา: พิมพ์  /setting สาขา <รหัสสาขา>',
      'ตั้งวิธีจ่าย: พิมพ์  /setting จ่าย โอน',
      'ตั้งกลุ่มส่งสลิป: พิมพ์  /setting สลิป',
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
