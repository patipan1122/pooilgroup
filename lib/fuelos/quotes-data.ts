import { prisma } from "@/lib/prisma";
import type { QuoteStatus } from "@/lib/generated/prisma/enums";

export type QuoteFilter = "all" | QuoteStatus;

const VALID_STATUS: QuoteStatus[] = ["PENDING", "WON", "LOST", "DECLINED", "NO_RESPONSE"];

export function parseQuoteFilter(raw: string | undefined): QuoteFilter {
  if (raw && (VALID_STATUS as string[]).includes(raw)) return raw as QuoteStatus;
  return "all";
}

// รายการใบเสนอราคา (กรองตามสถานะได้) — แสดงชื่อลูกค้า/ผู้สนใจ + ยอด + เซลล์
export async function listQuotes(orgId: string, filter: QuoteFilter) {
  const where: { orgId: string; status?: QuoteStatus } = { orgId };
  if (filter !== "all") where.status = filter;

  const rows = await prisma.quote.findMany({
    where,
    orderBy: { quoteDate: "desc" },
    take: 300,
    include: {
      customer: { select: { name: true } },
      sales: { select: { name: true } },
    },
  });

  return rows.map((q) => ({
    id: q.id,
    quoteNo: q.quoteNo,
    name: q.customer?.name ?? q.prospectName ?? "—",
    isProspect: !q.customerId,
    quoteDate: q.quoteDate,
    subtotal: Number(q.subtotal),
    status: q.status,
    sales: q.sales?.name ?? "—",
  }));
}

// นับจำนวนตามสถานะ สำหรับ badge บนแท็บกรอง
export async function countByStatus(orgId: string) {
  const grouped = await prisma.quote.groupBy({
    by: ["status"],
    where: { orgId },
    _count: { _all: true },
  });
  const out: Record<string, number> = { all: 0 };
  for (const g of grouped) {
    out[g.status] = g._count._all;
    out.all += g._count._all;
  }
  return out;
}

// รายละเอียดใบเสนอราคา 1 ใบ (ใน org) + items + ลูกค้า + เซลล์
export async function getQuote(orgId: string, id: string) {
  const q = await prisma.quote.findFirst({
    where: { id, orgId },
    include: {
      items: true,
      customer: { select: { id: true, name: true, legalName: true, phone: true, zone: true } },
      sales: { select: { id: true, name: true } },
    },
  });
  return q;
}

// อ่านใบเสนอราคาผ่าน public token (สำหรับหน้าลูกค้าเปิด — ไม่ต้อง login)
export async function getQuoteByToken(token: string) {
  const q = await prisma.quote.findUnique({
    where: { publicToken: token },
    include: {
      items: true,
      customer: { select: { name: true, legalName: true } },
      org: { select: { name: true } },
    },
  });
  return q;
}

// ตัวเลือกลูกค้าสำหรับ dropdown ในฟอร์มสร้างใบเสนอราคา
export async function listCustomerOptions(orgId: string) {
  const rows = await prisma.customer.findMany({
    where: { orgId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, zone: true },
    take: 1000,
  });
  return rows.map((c) => ({ id: c.id, name: c.name, zone: c.zone }));
}

// แปลง conversationId → ลูกค้าที่ผูกอยู่ (สำหรับ prefill จากหน้าแชท)
export async function resolveConversationCustomer(orgId: string, conversationId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    select: { id: true, customerId: true, displayName: true },
  });
  return conv;
}

export async function getCustomerLite(orgId: string, customerId: string) {
  return prisma.customer.findFirst({
    where: { id: customerId, orgId },
    select: { id: true, name: true, zone: true },
  });
}
