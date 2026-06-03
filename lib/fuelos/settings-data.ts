import { prisma } from "@/lib/prisma";
import type { FuelUserRole } from "@/lib/generated/prisma/enums";

// ---------- team (พนักงาน) ----------
export type SettingsUser = {
  id: string;
  name: string;
  email: string;
  role: FuelUserRole;
  isActive: boolean;
  phone: string | null;
  lineUserIds: string[];
};

export async function listUsers(orgId: string): Promise<SettingsUser[]> {
  const rows = await prisma.fuelUser.findMany({
    where: { orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { lineIdentities: { select: { lineUserId: true } } },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    phone: u.phone,
    lineUserIds: u.lineIdentities.map((l) => l.lineUserId),
  }));
}

// นับว่าพนักงานแต่ละคนถือลูกค้า/แชทกี่ราย (ใช้ตอนโอนงาน F12)
export async function getStaffWorkload(orgId: string): Promise<Record<string, { customers: number; conversations: number }>> {
  const [custGroups, convGroups] = await Promise.all([
    prisma.customer.groupBy({
      by: ["assignedSalesId"],
      where: { orgId, assignedSalesId: { not: null } },
      _count: { _all: true },
    }),
    prisma.conversation.groupBy({
      by: ["assignedToId"],
      where: { orgId, assignedToId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const out: Record<string, { customers: number; conversations: number }> = {};
  for (const g of custGroups) {
    if (!g.assignedSalesId) continue;
    out[g.assignedSalesId] = { customers: g._count._all, conversations: 0 };
  }
  for (const g of convGroups) {
    if (!g.assignedToId) continue;
    out[g.assignedToId] = { ...(out[g.assignedToId] ?? { customers: 0, conversations: 0 }), conversations: g._count._all };
  }
  return out;
}

// ---------- line (ช่องทาง LINE) ----------
export type SettingsChannel = {
  id: string;
  displayName: string;
  externalId: string | null;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  botEnabled: boolean;
  status: string;
};

export async function listChannels(orgId: string): Promise<SettingsChannel[]> {
  const rows = await prisma.fuelInboxChannel.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    externalId: c.externalId,
    hasAccessToken: !!c.accessTokenEnc,
    hasWebhookSecret: !!c.webhookSecret,
    botEnabled: c.botEnabled,
    status: c.status,
  }));
}

// ---------- bank (บัญชีธนาคาร) ----------
export type SettingsBank = {
  id: string;
  bankName: string;
  accountName: string;
  accountNo: string;
  isDefault: boolean;
};

export async function listBanks(orgId: string): Promise<SettingsBank[]> {
  const rows = await prisma.bankAccount.findMany({
    where: { orgId },
    orderBy: [{ isDefault: "desc" }, { bankName: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    bankName: b.bankName,
    accountName: b.accountName,
    accountNo: b.accountNo,
    isDefault: b.isDefault,
  }));
}

// ---------- bot (บอท FAQ) ----------
export type SettingsFaq = {
  id: string;
  keywords: string;
  answer: string;
  enabled: boolean;
  priority: number;
  hits: number;
};

export async function listFaqs(orgId: string): Promise<SettingsFaq[]> {
  const rows = await prisma.botFaq.findMany({
    where: { orgId },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((f) => ({
    id: f.id,
    keywords: f.keywords,
    answer: f.answer,
    enabled: f.enabled,
    priority: f.priority,
    hits: f.hits,
  }));
}
