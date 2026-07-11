// DC → ClawFleet · แปลงสินค้า DC เป็นสินค้า ClawFleet (CfProduct) แบบเสถียร (stable mapping).
//
// เวลาโอนของจาก DC เข้า "สโตร์สาขา" ของตู้คีบ (ClawFleet) เราต้องรู้ว่าสินค้า DC ตัวนี้
// = สินค้า ClawFleet ตัวไหน. ขั้นตอน (idempotent · ปลอดภัยต่อ race):
//   (a) เคยผูกไว้แล้ว (DcProductLink) → ใช้ตัวนั้นเลย (1:1 ต่อ productId+destModule · deterministic)
//   (b) ยังไม่ผูก → auto-match ด้วย "barcode เท่านั้น" (แม่นยำ · unique ต่อ org).
//       ★ ห้าม proactive-match ด้วย SKU — สตริง SKU ของ DC กับ ClawFleet ต่างกัน (คนละระบบตั้ง)
//         การเดา SKU ตรงกัน = เสี่ยงเอาสต๊อก+ต้นทุนไปแปะสินค้าคนละตัว (mis-attribution เงิน).
//   (c) ไม่เจอ barcode → สร้าง CfProduct ใหม่ใน catalog ของ org (CEO: "ไม่เจอ→สร้างในสโตร์สาขาให้เลย")
//        แล้วบันทึก DcProductLink ให้ครั้งหน้าเจอทันที
//
// NOTE (money-safe): ฟังก์ชันนี้ไม่แตะสต๊อก/ต้นทุนเลย — แค่ resolve/สร้าง "ตัวสินค้า" (catalog).
//   การเขียนสต๊อก + ต้นทุนเฉลี่ยถ่วงน้ำหนักทำใน receiveDcTransferIntoBranch (stock-actions.ts).

import { prisma } from "@/lib/prisma";

/** ชื่อโมดูลปลายทางใน DcProductLink.destModule สำหรับ ClawFleet */
export const CLAWFLEET_MODULE = "clawfleet";

/** duck-typed Prisma unique-violation check (เหมือน errCode ทั่ว codebase — ไม่พึ่ง instanceof) */
function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * ดึงว่า P2002 ชนที่ field ไหน (barcode / sku) จาก meta.target ของ Prisma.
 * meta.target อาจเป็น array ของชื่อ column หรือชื่อ constraint (เช่น "cf_products_org_id_barcode_key")
 * → normalize เป็น string เดียวแล้วเช็ค substring. คืน "barcode" | "sku" | null (ไม่รู้แน่).
 */
function p2002Field(e: unknown): "barcode" | "sku" | null {
  const target = (e as { meta?: { target?: unknown } })?.meta?.target;
  const s = Array.isArray(target) ? target.join(",").toLowerCase() : String(target ?? "").toLowerCase();
  if (s.includes("barcode")) return "barcode";
  if (s.includes("sku")) return "sku";
  return null;
}

/** สาขานี้เป็นสาขาตู้คีบ (ClawFleet) ไหม — ใช้ตัดสินว่าการโอน MODULE นี้ควรเขียนเข้า CF stock */
export async function isClawfleetBranch(orgId: string, branchId: string): Promise<boolean> {
  const b = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  return !!b;
}

/**
 * ★ CROSS-ORG GUARD (Fix 2 · money-critical): ยืนยันว่า branchId ที่ปลายทางเป็น
 *   "สาขาตู้คีบของ org ผู้เรียกจริง" — orgId ตรง + businessType=claw_machine + isActive.
 *   ถ้าไม่ผ่าน → คืนสาเหตุ (ไม่ throw) ให้ caller แปลงเป็น error แล้วไม่เขียนสต๊อกเลย.
 *   กัน toBranchId ที่ crafted มา (สาขาของ org อื่น / ไม่ใช่ตู้คีบ / ปิดใช้งาน) เขียนสต๊อกข้ามองค์กร.
 */
export async function assertClawfleetBranchInOrg(
  orgId: string,
  branchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const b = await prisma.branch.findFirst({
    where: { id: branchId, orgId },
    select: { businessType: true, isActive: true },
  });
  if (!b) return { ok: false, error: "ไม่พบสาขาปลายทางในองค์กรนี้" };
  if (b.businessType !== "claw_machine") return { ok: false, error: "สาขาปลายทางไม่ใช่สาขาตู้คีบ" };
  if (!b.isActive) return { ok: false, error: "สาขาปลายทางถูกปิดใช้งานแล้ว" };
  return { ok: true };
}

export type ResolveClawfleetProductResult = { cfProductId: string; created: boolean };

/**
 * แปลง DcProduct → CfProduct (สร้างถ้าไม่มี). idempotent + safe ต่อ concurrent create.
 * @param unitCostCents ต้นทุน (cents = satang · 1:1) ที่พกมากับใบโอน — ใช้ตั้งต้นทุนตอน "สร้างใหม่" เท่านั้น
 *   (ต้นทุนเฉลี่ยถ่วงน้ำหนักจริงคำนวณตอนรับเข้าใน receiveDcTransferIntoBranch — ที่นี่แค่ค่าตั้งต้น catalog)
 */
export async function resolveClawfleetProduct(
  orgId: string,
  dcProduct: { id: string; sku: string; barcode: string | null; name: string; imageUrl: string | null },
  unitCostCents: number,
  actorUserId: string,
): Promise<ResolveClawfleetProductResult> {
  // (a) เคยผูกไว้แล้ว → ใช้ตัวเดิม (เสถียร · ครั้งหน้าไม่ต้อง match ใหม่).
  //   ★ 1:1 ENFORCEMENT (Fix 4): findFirst + orderBy createdAt asc → ถ้ามีหลายแถว (ไม่ควรมี · กัน race
  //   สองใบ resolve พร้อมกันแล้วสร้าง link คนละตัว) เลือกแถวเก่าสุดเสมอ (deterministic) → DC สินค้าตัวนี้
  //   ผูกกับ CfProduct "ตัวเดียว" ทุกครั้ง (สต๊อกไม่แตกไปสอง CfProduct).
  const existingLink = await prisma.dcProductLink.findFirst({
    where: { productId: dcProduct.id, destModule: CLAWFLEET_MODULE },
    orderBy: { id: "asc" },
    select: { destProductId: true },
  });
  if (existingLink) return { cfProductId: existingLink.destProductId, created: false };

  // (b) auto-match: "barcode เท่านั้น" (แม่นยำ · unique ต่อ org). ห้าม match ด้วย SKU (mis-attribution).
  let matched: { id: string } | null = null;
  if (dcProduct.barcode) {
    matched = await prisma.cfProduct.findFirst({
      where: { orgId, barcode: dcProduct.barcode },
      select: { id: true },
    });
  }
  if (matched) {
    await upsertLink(orgId, dcProduct.id, matched.id);
    return { cfProductId: matched.id, created: false };
  }

  // (c) ไม่เจอ barcode → สร้าง CfProduct ใหม่ในแคตตาล็อกของ org (ตกลง 1:1 satang→cents · ไม่สเกล)
  let cfProductId: string;
  let created = true;
  try {
    const cf = await prisma.cfProduct.create({
      data: {
        orgId,
        sku: dcProduct.sku,
        barcode: dcProduct.barcode,
        name: dcProduct.name,
        // category default = PLUSH (schema default) — ปล่อยให้ default จัดการ
        unitCostCents: Math.max(0, Math.trunc(unitCostCents)),
        imageUrl: dcProduct.imageUrl,
        isActive: true,
      },
      select: { id: true },
    });
    cfProductId = cf.id;
  } catch (e) {
    // race / ชน @@unique[orgId,sku] หรือ [orgId,barcode] → มีคนสร้างไปก่อน (concurrent create).
    // ★ FIELD-CONSISTENT RECOVERY (Fix 3): re-query ด้วย "field เดียวกับที่ชน" เท่านั้น —
    //   barcode ชน → หา by barcode · sku ชน → หา by sku. ห้ามปน predicate (ไม่งั้นชน sku แต่ไปหยิบ
    //   CfProduct ที่ barcode เดียวกันแต่คนละตัว = แปะสต๊อกผิดตัว).
    const field = isP2002(e) ? p2002Field(e) : null;
    if (field === "barcode" && dcProduct.barcode) {
      const again = await prisma.cfProduct.findFirst({ where: { orgId, barcode: dcProduct.barcode }, select: { id: true } });
      if (!again) throw e; // ชนแต่หาไม่เจอ = ผิดปกติจริง → โยนต่อ
      cfProductId = again.id;
      created = false;
    } else if (field === "sku") {
      const again = await prisma.cfProduct.findFirst({ where: { orgId, sku: dcProduct.sku }, select: { id: true } });
      if (!again) throw e;
      cfProductId = again.id;
      created = false;
    } else {
      // P2002 แต่แยก field ไม่ออก (meta.target ว่าง) → fallback: ลอง barcode ก่อน (ถ้ามี) แล้ว sku
      // ด้วยลำดับ deterministic เดียวกับ match. ถ้ายังไม่เจอ = error จริง → โยนต่อ.
      if (!isP2002(e)) throw e;
      const again =
        (dcProduct.barcode
          ? await prisma.cfProduct.findFirst({ where: { orgId, barcode: dcProduct.barcode }, select: { id: true } })
          : null) ??
        (dcProduct.sku
          ? await prisma.cfProduct.findFirst({ where: { orgId, sku: dcProduct.sku }, select: { id: true } })
          : null);
      if (!again) throw e;
      cfProductId = again.id;
      created = false;
    }
  }

  await upsertLink(orgId, dcProduct.id, cfProductId);
  return { cfProductId, created };
}

/**
 * บันทึก DcProductLink แบบ "1:1 ต่อ (productId, destModule)" (Fix 4 · ไม่ใช้ migration).
 *   - schema @@unique เป็น [productId,destModule,destProductId] (ยอมให้ 1 DC ผูกหลาย CfProduct ได้ในทางเทคนิค)
 *     → เราบังคับ 1:1 ที่ชั้น app: ถ้า "มี link ของ (productId, destModule) อยู่แล้ว" (ไม่ว่าชี้ไปตัวไหน)
 *       = no-op ไม่สร้างเพิ่ม → DC สินค้าตัวนี้จะไม่ผูกกับ CfProduct สองตัว (สต๊อกไม่แตก).
 *   - ยังไม่มี → สร้าง (กลืน P2002 กรณี race สองคนสร้างแถวเดียวกัน = ผลลัพธ์เหมือนกัน).
 */
async function upsertLink(orgId: string, dcProductId: string, cfProductId: string): Promise<void> {
  // มี link อยู่แล้วสำหรับ (productId, destModule) ตัวใดตัวหนึ่ง? → 1:1 → ไม่สร้างเพิ่ม
  const existing = await prisma.dcProductLink.findFirst({
    where: { productId: dcProductId, destModule: CLAWFLEET_MODULE },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (existing) return; // 1:1 lock — ผูกไว้แล้ว ไม่ผูกซ้ำกับ CfProduct อื่น

  try {
    await prisma.dcProductLink.create({
      data: {
        orgId,
        productId: dcProductId,
        destModule: CLAWFLEET_MODULE,
        destProductId: cfProductId,
      },
    });
  } catch (e) {
    // race: 2 คน create link ของ (productId,destModule,destProductId) เดียวกันพร้อมกัน → P2002
    //   = แถวมีอยู่แล้ว (ผลลัพธ์ตรงตามต้องการ · idempotent). field อื่น → โยนต่อ.
    if (!isP2002(e)) throw e;
  }
}
