"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, atLeast, RANK } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import { hashPassword } from "@/lib/fuelos/password";
import type { FuelUserRole } from "@/lib/generated/prisma/enums";

const ROLE_VALUES: FuelUserRole[] = ["OWNER", "ADMIN", "SALES_HEAD", "FINANCE", "DISPATCH", "SALES", "DRIVER"];

// ทุก action ในหน้า Settings ต้องเป็น ADMIN ขึ้นไป
async function requireAdmin() {
  const user = await requireUser();
  if (!atLeast(user.role, "ADMIN")) {
    throw new Error("ต้องเป็นแอดมินขึ้นไปจึงจะตั้งค่าได้");
  }
  return user;
}

// ---------- team (พนักงาน) ----------
export async function createUser(formData: FormData) {
  const user = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const roleRaw = String(formData.get("role") ?? "SALES");
  const role: FuelUserRole = (ROLE_VALUES as string[]).includes(roleRaw) ? (roleRaw as FuelUserRole) : "SALES";

  if (!name || !email || password.length < 6) {
    return { ok: false, error: "กรอกชื่อ อีเมล และรหัสผ่าน (อย่างน้อย 6 ตัว)" };
  }
  // กัน privilege escalation: ห้ามสร้างคนที่บทบาทสูงกว่า/เท่ากับตัวเอง (ยกเว้น OWNER)
  if (user.role !== "OWNER" && RANK[role] >= RANK[user.role]) {
    return { ok: false, error: "ไม่มีสิทธิ์สร้างผู้ใช้บทบาทนี้" };
  }
  const dup = await prisma.fuelUser.findUnique({ where: { email }, select: { id: true } });
  if (dup) return { ok: false, error: "อีเมลนี้ถูกใช้แล้ว" };

  const created = await prisma.fuelUser.create({
    data: {
      orgId: user.orgId,
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      phone: String(formData.get("phone") ?? "") || null,
    },
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "USER_CREATE", entity: "FuelUser", entityId: created.id, meta: { email, role } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

export async function setUserActive(id: string, isActive: boolean) {
  const user = await requireAdmin();
  // กันปิดการใช้งานตัวเอง (ล็อกตัวเองออก)
  if (id === user.id && !isActive) return { ok: false, error: "ปิดการใช้งานบัญชีตัวเองไม่ได้" };
  const target = await prisma.fuelUser.findFirst({ where: { id, orgId: user.orgId }, select: { id: true, role: true } });
  if (!target) return { ok: false, error: "ไม่พบพนักงาน" };
  // กันปิด/แก้คนที่บทบาทสูงกว่าหรือเท่ากับตัวเอง (ยกเว้น OWNER)
  if (user.role !== "OWNER" && RANK[target.role] >= RANK[user.role]) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการพนักงานบทบาทนี้" };
  }
  await prisma.fuelUser.update({ where: { id }, data: { isActive } });
  await audit({ orgId: user.orgId, userId: user.id, action: "USER_SET_ACTIVE", entity: "FuelUser", entityId: id, meta: { isActive } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

export async function setUserRole(id: string, role: FuelUserRole) {
  const user = await requireAdmin();
  if (!(ROLE_VALUES as string[]).includes(role)) return { ok: false, error: "บทบาทไม่ถูกต้อง" };
  const target = await prisma.fuelUser.findFirst({ where: { id, orgId: user.orgId }, select: { id: true, role: true } });
  if (!target) return { ok: false, error: "ไม่พบพนักงาน" };
  // กัน escalation: ห้ามตั้งบทบาทสูงกว่า/เท่าตัวเอง และห้ามแก้คนที่สูงกว่า/เท่าตัวเอง (ยกเว้น OWNER)
  if (user.role !== "OWNER" && (RANK[role] >= RANK[user.role] || RANK[target.role] >= RANK[user.role])) {
    return { ok: false, error: "ไม่มีสิทธิ์กำหนดบทบาทนี้" };
  }
  await prisma.fuelUser.update({ where: { id }, data: { role } });
  await audit({ orgId: user.orgId, userId: user.id, action: "USER_SET_ROLE", entity: "FuelUser", entityId: id, meta: { role } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

// แมป LINE userId ของพนักงาน (รู้ว่าใครตอบในกลุ่ม)
export async function setStaffLine(userId: string, lineUserId: string) {
  const user = await requireAdmin();
  const id = lineUserId.trim();
  if (!id) return { ok: false, error: "กรอก LINE userId" };
  const target = await prisma.fuelUser.findFirst({ where: { id: userId, orgId: user.orgId }, select: { id: true } });
  if (!target) return { ok: false, error: "ไม่พบพนักงาน" };
  // กันชนกับเจ้าของเดิม (lineUserId unique)
  const existing = await prisma.staffLineIdentity.findUnique({ where: { lineUserId: id }, select: { userId: true } });
  if (existing && existing.userId !== userId) {
    return { ok: false, error: "LINE userId นี้ถูกผูกกับพนักงานคนอื่นแล้ว" };
  }
  if (existing) {
    revalidatePath("/fuelos/settings");
    return { ok: true };
  }
  await prisma.staffLineIdentity.create({ data: { orgId: user.orgId, userId, lineUserId: id } });
  await audit({ orgId: user.orgId, userId: user.id, action: "STAFF_LINE_SET", entity: "StaffLineIdentity", entityId: userId, meta: { lineUserId: id } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

export async function removeStaffLine(userId: string, lineUserId: string) {
  const user = await requireAdmin();
  const rec = await prisma.staffLineIdentity.findUnique({ where: { lineUserId }, select: { id: true, userId: true, orgId: true } });
  if (!rec || rec.orgId !== user.orgId || rec.userId !== userId) return { ok: false, error: "ไม่พบรายการ" };
  await prisma.staffLineIdentity.delete({ where: { id: rec.id } });
  await audit({ orgId: user.orgId, userId: user.id, action: "STAFF_LINE_REMOVE", entity: "StaffLineIdentity", entityId: userId, meta: { lineUserId } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

// F12 ส่งต่องาน — โอนลูกค้า + แชททั้งหมดจากพนักงาน A → B
export async function reassignAll(fromUserId: string, toUserId: string) {
  const user = await requireAdmin();
  if (fromUserId === toUserId) return { ok: false, error: "เลือกพนักงานปลายทางที่ต่างจากต้นทาง" };
  const [from, to] = await Promise.all([
    prisma.fuelUser.findFirst({ where: { id: fromUserId, orgId: user.orgId }, select: { id: true, name: true } }),
    prisma.fuelUser.findFirst({ where: { id: toUserId, orgId: user.orgId }, select: { id: true, name: true } }),
  ]);
  if (!from || !to) return { ok: false, error: "ไม่พบพนักงานต้นทาง/ปลายทาง" };

  const [cust, conv] = await prisma.$transaction([
    prisma.customer.updateMany({
      where: { orgId: user.orgId, assignedSalesId: fromUserId },
      data: { assignedSalesId: toUserId },
    }),
    prisma.conversation.updateMany({
      where: { orgId: user.orgId, assignedToId: fromUserId },
      data: { assignedToId: toUserId },
    }),
  ]);

  await audit({
    orgId: user.orgId, userId: user.id, action: "STAFF_REASSIGN_ALL", entity: "FuelUser", entityId: fromUserId,
    meta: { from: from.name, to: to.name, customers: cust.count, conversations: conv.count },
  });
  revalidatePath("/fuelos/settings");
  revalidatePath("/fuelos/customers");
  revalidatePath("/fuelos/inbox");
  return { ok: true, customers: cust.count, conversations: conv.count };
}

// ---------- line (ช่องทาง LINE) ----------
export async function upsertChannel(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "") || null;
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) return { ok: false, error: "กรอกชื่อช่องทาง" };
  const externalId = String(formData.get("externalId") ?? "").trim() || null;
  const accessToken = String(formData.get("accessToken") ?? "").trim();
  const webhookSecret = String(formData.get("webhookSecret") ?? "").trim();

  if (id) {
    const existing = await prisma.fuelInboxChannel.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
    if (!existing) return { ok: false, error: "ไม่พบช่องทาง" };
    await prisma.fuelInboxChannel.update({
      where: { id },
      data: {
        displayName,
        externalId,
        // แก้เฉพาะเมื่อกรอกค่าใหม่เข้ามา (เว้นว่าง = คงค่าเดิม)
        ...(accessToken ? { accessTokenEnc: accessToken } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      },
    });
    await audit({ orgId: user.orgId, userId: user.id, action: "CHANNEL_UPDATE", entity: "FuelInboxChannel", entityId: id });
  } else {
    const created = await prisma.fuelInboxChannel.create({
      data: {
        orgId: user.orgId,
        displayName,
        externalId,
        accessTokenEnc: accessToken || null,
        webhookSecret: webhookSecret || null,
        status: accessToken ? "active" : "setup",
      },
    });
    await audit({ orgId: user.orgId, userId: user.id, action: "CHANNEL_CREATE", entity: "FuelInboxChannel", entityId: created.id });
  }
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

export async function toggleChannelBot(id: string, botEnabled: boolean) {
  const user = await requireAdmin();
  const existing = await prisma.fuelInboxChannel.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
  if (!existing) return { ok: false, error: "ไม่พบช่องทาง" };
  await prisma.fuelInboxChannel.update({ where: { id }, data: { botEnabled } });
  await audit({ orgId: user.orgId, userId: user.id, action: "CHANNEL_TOGGLE_BOT", entity: "FuelInboxChannel", entityId: id, meta: { botEnabled } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

// ---------- bank (บัญชีธนาคาร) ----------
export async function upsertBank(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "") || null;
  const bankName = String(formData.get("bankName") ?? "").trim();
  const accountName = String(formData.get("accountName") ?? "").trim();
  const accountNo = String(formData.get("accountNo") ?? "").trim();
  const isDefault = formData.get("isDefault") === "on" || formData.get("isDefault") === "true";
  if (!bankName || !accountName || !accountNo) return { ok: false, error: "กรอกธนาคาร ชื่อบัญชี และเลขบัญชี" };

  // ถ้าตั้งเป็นค่าเริ่มต้น → ล้าง default เดิมก่อน (มี default เดียวต่อ org)
  const ops = [];
  if (isDefault) {
    ops.push(prisma.bankAccount.updateMany({ where: { orgId: user.orgId, isDefault: true }, data: { isDefault: false } }));
  }
  if (id) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
    if (!existing) return { ok: false, error: "ไม่พบบัญชี" };
    ops.push(prisma.bankAccount.update({ where: { id }, data: { bankName, accountName, accountNo, isDefault } }));
    await prisma.$transaction(ops);
    await audit({ orgId: user.orgId, userId: user.id, action: "BANK_UPDATE", entity: "BankAccount", entityId: id });
  } else {
    ops.push(prisma.bankAccount.create({ data: { orgId: user.orgId, bankName, accountName, accountNo, isDefault } }));
    await prisma.$transaction(ops);
    await audit({ orgId: user.orgId, userId: user.id, action: "BANK_CREATE", entity: "BankAccount" });
  }
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

export async function deleteBank(id: string) {
  const user = await requireAdmin();
  const existing = await prisma.bankAccount.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
  if (!existing) return { ok: false, error: "ไม่พบบัญชี" };
  await prisma.bankAccount.delete({ where: { id } });
  await audit({ orgId: user.orgId, userId: user.id, action: "BANK_DELETE", entity: "BankAccount", entityId: id });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

// ---------- bot (บอท FAQ) ----------
export async function upsertFaq(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "") || null;
  const keywords = String(formData.get("keywords") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "0");
  const priority = Number.isFinite(Number(priorityRaw)) ? Math.trunc(Number(priorityRaw)) : 0;
  if (!keywords || !answer) return { ok: false, error: "กรอกคำค้นและคำตอบ" };

  if (id) {
    const existing = await prisma.botFaq.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
    if (!existing) return { ok: false, error: "ไม่พบ FAQ" };
    await prisma.botFaq.update({ where: { id }, data: { keywords, answer, priority } });
    await audit({ orgId: user.orgId, userId: user.id, action: "FAQ_UPDATE", entity: "BotFaq", entityId: id });
  } else {
    const created = await prisma.botFaq.create({ data: { orgId: user.orgId, keywords, answer, priority } });
    await audit({ orgId: user.orgId, userId: user.id, action: "FAQ_CREATE", entity: "BotFaq", entityId: created.id });
  }
  revalidatePath("/fuelos/settings");
  return { ok: true };
}

export async function toggleFaq(id: string, enabled: boolean) {
  const user = await requireAdmin();
  const existing = await prisma.botFaq.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
  if (!existing) return { ok: false, error: "ไม่พบ FAQ" };
  await prisma.botFaq.update({ where: { id }, data: { enabled } });
  await audit({ orgId: user.orgId, userId: user.id, action: "FAQ_TOGGLE", entity: "BotFaq", entityId: id, meta: { enabled } });
  revalidatePath("/fuelos/settings");
  return { ok: true };
}
