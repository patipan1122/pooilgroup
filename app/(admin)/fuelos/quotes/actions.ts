"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import { genQuoteNo, genOrderNo, genToken } from "@/lib/fuelos/ids";
import { getPricingContext } from "@/lib/fuelos/pricing-data";
import { round2, round4, PRODUCT_ORDER } from "@/lib/fuelos/pricing";
import type { ProductType, QuoteStatus } from "@/lib/generated/prisma/enums";

const TRANSPORT_DEFAULT = 0.35; // ค่าขนส่งเริ่มต้น ฿/ลิตร (ใช้ตอนแปลงเป็นออเดอร์)

export type QuoteLineInput = {
  productType: string;
  qtyLiters: number;
  salesMargin: number;
};

export type CreateQuoteInput = {
  customerId?: string | null;
  prospectName?: string | null;
  prospectPhone?: string | null;
  conversationId?: string | null;
  notes?: string | null;
  validUntil?: string | null; // yyyy-mm-dd
  lines: QuoteLineInput[];
};

function isProduct(v: string): v is ProductType {
  return (PRODUCT_ORDER as readonly string[]).includes(v);
}

// สร้างใบเสนอราคา + บรรทัดสินค้า · ราคา = ต้นทุนวันนี้ + กำไรโซน + เซลล์บวกเพิ่ม
export async function createQuote(input: CreateQuoteInput) {
  const user = await requireUser();

  // coerce + validate ปริมาณ (กัน NaN/ติดลบ/เกินจริง · ปัด 3 ตำแหน่งให้ตรงกับคอลัมน์)
  const lines = input.lines
    .map((l) => ({ productType: l.productType, qtyLiters: Math.round(Number(l.qtyLiters) * 1000) / 1000, salesMargin: Number(l.salesMargin) }))
    .filter((l) => isProduct(l.productType) && Number.isFinite(l.qtyLiters) && l.qtyLiters > 0 && l.qtyLiters <= 1_000_000);
  if (lines.length === 0) return { ok: false, error: "ต้องมีสินค้าอย่างน้อย 1 รายการ" };

  const customerId = input.customerId || null;
  const prospectName = (input.prospectName ?? "").trim() || null;
  const prospectPhone = (input.prospectPhone ?? "").trim() || null;
  if (!customerId && !prospectName) {
    return { ok: false, error: "ระบุลูกค้าเดิม หรือชื่อผู้สนใจรายใหม่" };
  }

  // หาโซนของลูกค้าเพื่อดึงกำไรโซน (zone base margin)
  let zone: string | null = null;
  if (customerId) {
    const c = await prisma.customer.findFirst({ where: { id: customerId, orgId: user.orgId }, select: { zone: true } });
    zone = c?.zone ?? null;
  }

  const ctx = await getPricingContext(user.orgId);

  const items: { productType: ProductType; qtyLiters: number; costPerL: number; zoneMargin: number; salesMargin: number; finalPrice: number; lineTotal: number }[] = [];
  for (const l of lines) {
    const product = l.productType as ProductType;
    const cost = ctx.costs[product];
    if (cost == null) return { ok: false, error: `ยังไม่ได้ตั้งราคาต้นทุน ${product} วันนี้` };
    // โซนมีแต่ไม่ได้ตั้ง margin ของสินค้านี้ → default 0.45 (กันขายต่ำกว่าทุน)
    const zoneMargin = zone ? ctx.margins[zone]?.[product]?.base ?? 0.45 : 0.45;
    const minMargin = zone ? ctx.margins[zone]?.[product]?.min ?? 0 : 0;
    const salesMargin = Number.isFinite(l.salesMargin) ? l.salesMargin : 0;
    const finalPrice = round4(cost + zoneMargin + salesMargin);
    // กันขายต่ำกว่าทุน+กำไรขั้นต่ำ (server-side enforce — ไม่เชื่อ client)
    if (finalPrice < cost + minMargin) {
      return { ok: false, error: `ราคา ${product} (${finalPrice.toFixed(2)}) ต่ำกว่าขั้นต่ำ (ทุน ${cost.toFixed(2)} + ขั้นต่ำ ${minMargin.toFixed(2)})` };
    }
    const lineTotal = round2(finalPrice * l.qtyLiters);
    items.push({ productType: product, qtyLiters: l.qtyLiters, costPerL: cost, zoneMargin, salesMargin, finalPrice, lineTotal });
  }

  const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));
  const quoteNo = genQuoteNo();
  const publicToken = genToken();

  const quote = await prisma.quote.create({
    data: {
      orgId: user.orgId,
      quoteNo,
      customerId,
      prospectName: customerId ? null : prospectName,
      prospectPhone: customerId ? null : prospectPhone,
      salesId: user.id,
      conversationId: input.conversationId || null,
      status: "PENDING",
      publicToken,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      subtotal,
      notes: (input.notes ?? "").trim() || null,
      items: {
        create: items.map((it) => ({
          productType: it.productType,
          qtyLiters: it.qtyLiters,
          costPerL: it.costPerL,
          zoneMargin: it.zoneMargin,
          salesMargin: it.salesMargin,
          finalPrice: it.finalPrice,
          lineTotal: it.lineTotal,
        })),
      },
    },
  });

  // ปรับ lastQuoteAt ของลูกค้า เพื่อ CRM health รู้ว่าเสนอราคาแล้ว
  if (customerId) {
    await prisma.customer.update({ where: { id: customerId, orgId: user.orgId }, data: { lastQuoteAt: new Date() } });
  }

  await audit({ orgId: user.orgId, userId: user.id, action: "QUOTE_CREATE", entity: "Quote", entityId: quote.id, meta: { quoteNo, subtotal } });

  revalidatePath("/fuelos/quotes");
  redirect(`/fuelos/quotes/${quote.id}`);
}

// บันทึกผลใบเสนอราคา: ชนะ / แพ้ / ลูกค้าปฏิเสธ / ไม่ตอบ
export async function setQuoteResult(
  quoteId: string,
  status: QuoteStatus,
  lostTo?: string | null,
  competitorPrice?: number | null,
) {
  const user = await requireUser();
  const q = await prisma.quote.findFirst({ where: { id: quoteId, orgId: user.orgId }, select: { id: true, resultOrderId: true } });
  if (!q) return { ok: false, error: "ไม่พบใบเสนอราคา" };
  // ใบที่แปลงเป็นออเดอร์แล้ว ห้ามเปลี่ยนผล (กันสถานะ quote/order ขัดกัน)
  if (q.resultOrderId) return { ok: false, error: "ใบนี้ถูกแปลงเป็นออเดอร์แล้ว เปลี่ยนผลไม่ได้" };

  await prisma.quote.update({
    where: { id: quoteId, orgId: user.orgId },
    data: {
      status,
      lostTo: status === "LOST" ? (lostTo?.trim() || null) : null,
      competitorPrice: status === "LOST" && competitorPrice != null ? competitorPrice : null,
    },
  });

  await audit({ orgId: user.orgId, userId: user.id, action: "QUOTE_RESULT", entity: "Quote", entityId: quoteId, meta: { status, lostTo, competitorPrice } });

  revalidatePath(`/fuelos/quotes/${quoteId}`);
  revalidatePath("/fuelos/quotes");
  return { ok: true };
}

// แปลงใบเสนอราคา → ออเดอร์ (คัดลอกราคา · คำนวณกำไรหักค่าขนส่ง · ตั้ง CRM flags)
export async function convertToOrder(quoteId: string) {
  const user = await requireUser();

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, orgId: user.orgId },
    include: { items: true, customer: { select: { id: true, firstOrderAt: true } } },
  });
  if (!quote) return { ok: false, error: "ไม่พบใบเสนอราคา" };
  if (!quote.customerId || !quote.customer) {
    return { ok: false, error: "ใบเสนอราคานี้ยังไม่ผูกลูกค้าในระบบ — เพิ่มลูกค้าก่อนแปลงเป็นออเดอร์" };
  }
  if (quote.resultOrderId) {
    return { ok: false, error: "ใบเสนอราคานี้ถูกแปลงเป็นออเดอร์ไปแล้ว" };
  }
  if (quote.items.length === 0) return { ok: false, error: "ไม่มีรายการสินค้า" };

  const customerId = quote.customerId;
  const now = new Date();

  const orderItems = quote.items.map((it) => {
    const qty = Number(it.qtyLiters);
    const pricePerLiter = round4(Number(it.finalPrice));
    const costPerL = round4(Number(it.costPerL));
    const transportCostPerL = TRANSPORT_DEFAULT;
    const marginPerLiter = round4(pricePerLiter - costPerL);
    const lineTotal = round2(pricePerLiter * qty);
    const lineProfit = round2(qty * (marginPerLiter - transportCostPerL));
    return {
      productType: it.productType,
      qtyLiters: qty,
      pricePerLiter,
      costPerL,
      transportCostPerL,
      marginPerLiter,
      lineTotal,
      lineProfit,
    };
  });

  const subtotal = round2(orderItems.reduce((s, it) => s + it.lineTotal, 0));
  // ต้นทุนรวม = (ทุน + ขนส่ง) × ลิตร
  const totalCost = round2(orderItems.reduce((s, it) => s + (it.costPerL + it.transportCostPerL) * it.qtyLiters, 0));
  const totalProfit = round2(orderItems.reduce((s, it) => s + it.lineProfit, 0));
  const orderNo = genOrderNo();

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orgId: user.orgId,
        orderNo,
        customerId,
        salesId: user.id,
        sourceQuoteId: quote.id,
        status: "AWAITING_CONFIRM",
        subtotal,
        totalCost,
        totalProfit,
        items: {
          create: orderItems.map((it) => ({
            productType: it.productType,
            qtyLiters: it.qtyLiters,
            pricePerLiter: it.pricePerLiter,
            costPerL: it.costPerL,
            transportCostPerL: it.transportCostPerL,
            marginPerLiter: it.marginPerLiter,
            lineTotal: it.lineTotal,
            lineProfit: it.lineProfit,
          })),
        },
      },
    });

    // ใบเสนอราคา → WON + ผูก order
    await tx.quote.update({ where: { id: quote.id, orgId: user.orgId }, data: { status: "WON", resultOrderId: created.id } });

    // CRM: ลูกค้าใหม่ → ตั้ง firstOrderAt · ทุกครั้ง → อัปเดต lastOrderAt
    await tx.customer.update({
      where: { id: customerId, orgId: user.orgId },
      data: {
        ...(quote.customer && !quote.customer.firstOrderAt ? { firstOrderAt: now } : {}),
        lastOrderAt: now,
      },
    });

    return created;
  });

  await audit({ orgId: user.orgId, userId: user.id, action: "QUOTE_CONVERT", entity: "Order", entityId: order.id, meta: { quoteId: quote.id, orderNo, subtotal } });

  revalidatePath(`/fuelos/quotes/${quote.id}`);
  revalidatePath("/fuelos/quotes");
  revalidatePath("/fuelos/orders");
  redirect(`/fuelos/orders/${order.id}`);
}
