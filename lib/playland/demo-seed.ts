"use server";

// Playland · ตัวเติม "ข้อมูลตัวอย่าง" สำหรับหลังบ้าน (Dashboard/รายงาน/สต๊อก) — ให้ CEO เห็นหน้าจอมีชีวิต
// ไม่ใช่ ฿0 ทั้งหน้า · กดปุ่มเดียวเติม → ดูภาพรวม → กดล้างคืนสภาพเดิมได้ครบ
//
// แนวทาง (ตาม pattern ที่พิสูจน์แล้วใน lib/playland/stock.ts → seedSampleProducts):
//   • ทุก action เป็น "use server" · admin-gated ด้วย canPlaylandManage (เหมือน seedSampleProducts)
//   • scope แคบที่ "สาขาเดียว + orgId ของผู้เรียก" เสมอ
//   • idempotent + reversible: ทุกแถวตัวอย่างติด "ตรา" DEMO ที่ field เฉพาะ →
//       - products: barcode ขึ้นต้น "DEMO-" และ sku = DEMO_TAG
//       - sales:    paymentRef = DEMO_TAG (sale_lines ลบตามด้วย cascade)
//       - sessions: notes = DEMO_TAG
//       - members:  notes = DEMO_TAG
//       - shift:    notes = DEMO_TAG
//     → seedDemoData กดซ้ำ = ล้างของเก่าก่อนแล้วเติมใหม่ (re-run สะอาด)
//     → clearDemoData = ลบเฉพาะแถวที่ติดตรา DEMO เท่านั้น (ของจริงไม่แตะ)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandManage } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newSaleCode, newMemberCode, newShiftCode } from "./codes";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

// ── ตรา DEMO (ใช้ค้นเพื่อล้างทีหลัง) ─────────────────────────────────────────
const DEMO_TAG = "DEMO_SEED";
const DEMO_BARCODE_PREFIX = "DEMO-"; // สินค้าตัวอย่างของ seeder นี้ (แยกจาก seedSampleProducts ที่ใช้บาร์โค้ดจริง)

// ── สินค้าตัวอย่าง ~12 รายการ (ขนม/น้ำ) · ราคา/ต้นทุนเป็น "บาท" แปลงเป็นสตางค์ตอนสร้าง ──
// ตัวสุดท้ายตั้ง stock <= reorder ตั้งใจ → ให้ alert "ของใกล้หมด" โผล่บน dashboard
const DEMO_PRODUCTS: Array<{ name: string; category: string; priceBaht: number; costBaht: number; stock: number; reorder: number }> = [
  { name: "เลย์ รสโนริสาหร่าย 48g", category: "ขนม", priceBaht: 20, costBaht: 14, stock: 40, reorder: 12 },
  { name: "ตะวันแมงโก้ มะม่วงอบแห้ง", category: "ขนม", priceBaht: 25, costBaht: 17, stock: 30, reorder: 10 },
  { name: "ป๊อกกี้ สตรอเบอร์รี่", category: "ขนม", priceBaht: 20, costBaht: 13, stock: 36, reorder: 10 },
  { name: "เวเฟอร์ ฟันโอ ช็อกโกแลต", category: "ขนม", priceBaht: 15, costBaht: 9, stock: 50, reorder: 15 },
  { name: "น้ำดื่ม คริสตัล 600ml", category: "เครื่องดื่ม", priceBaht: 10, costBaht: 5, stock: 90, reorder: 24 },
  { name: "นมเปรี้ยว ดัชชี่ สตรอเบอร์รี่", category: "เครื่องดื่ม", priceBaht: 15, costBaht: 10, stock: 42, reorder: 12 },
  { name: "เอส โคล่า กระป๋อง 325ml", category: "เครื่องดื่ม", priceBaht: 15, costBaht: 9, stock: 48, reorder: 12 },
  { name: "ไมโล UHT 180ml", category: "เครื่องดื่ม", priceBaht: 15, costBaht: 10, stock: 38, reorder: 12 },
  { name: "ไอติม วอลล์ คอร์นเนตโต้", category: "ไอศกรีม", priceBaht: 25, costBaht: 16, stock: 28, reorder: 10 },
  { name: "เยลลี่ ปีโป้ ถ้วย", category: "ขนม", priceBaht: 10, costBaht: 6, stock: 60, reorder: 18 },
  { name: "ขนมปังฟาร์มเฮ้าส์ เนยสด", category: "เบเกอรี่", priceBaht: 22, costBaht: 15, stock: 24, reorder: 8 },
  // 👇 ตั้งใจให้ใกล้หมด: stock (5) <= reorder (10) → โชว์ alert "ของใกล้หมด"
  { name: "ลูกอม ฮอลล์ เมนทอล (ใกล้หมด)", category: "ขนม", priceBaht: 12, costBaht: 7, stock: 5, reorder: 10 },
];

// ── ชื่อสมาชิกตัวอย่าง (สร้างวันนี้ → "สมาชิกใหม่" > 0 + ผูก session ที่กำลังเล่น) ──
const DEMO_MEMBERS: Array<{ name: string; nickname: string; type: "KID" | "PARENT"; active: boolean }> = [
  { name: "น้องปันปัน (ตัวอย่าง)", nickname: "ปันปัน", type: "KID", active: true },
  { name: "น้องเจได (ตัวอย่าง)", nickname: "เจได", type: "KID", active: true },
  { name: "น้องมีนา (ตัวอย่าง)", nickname: "มีนา", type: "KID", active: true },
  { name: "คุณแม่สมหญิง (ตัวอย่าง)", nickname: "หญิง", type: "PARENT", active: false },
  { name: "น้องโฟกัส (ตัวอย่าง)", nickname: "โฟกัส", type: "KID", active: false },
];

const PAY_METHODS = ["CASH", "PROMPTPAY", "KBANK"] as const; // วิธีจ่ายตัวอย่าง (ทุกตัวอยู่ใน enum PlaylandPaymentMethod)
const ENTRY_PRICES_BAHT = [60, 80, 120, 150, 250]; // ค่าเข้า/ต่อเวลา ราคาจริงโดยประมาณ

// helper: deterministic-ish pseudo random ตามวัน → กราฟดูเป็นเทรนด์ ไม่สุ่มมั่ว
function pick<T>(arr: readonly T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length];
}

// ============================================================================
// SEED — เติมข้อมูลตัวอย่าง (สาขาเดียว + org ของผู้เรียก)
// ============================================================================
export async function seedDemoData(input: { branchId: string }): Promise<ActionResult<{
  products: number; sales: number; saleLines: number; members: number; sessions: number;
}>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์ · ต้องเป็นผู้จัดการขึ้นไป");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  const orgId = session.user.org_id;
  const branchId = input.branchId;
  const userId = session.user.id;

  // ขอบเขตวันสำหรับ "กราฟ 14 วัน" — ใช้เวลา local ของ server (รันใน node ตอน request จริง)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // กดซ้ำได้: ล้างของเดิมที่ติดตรา DEMO ก่อน (re-run = สะอาด · ไม่ทับซ้อน)
  await clearDemoRows(orgId, branchId);

  let productsCreated = 0, salesCreated = 0, saleLinesCreated = 0, membersCreated = 0, sessionsCreated = 0;

  await prisma.$transaction(async (tx) => {
    // ── 1) สินค้าตัวอย่าง ────────────────────────────────────────────────
    let sort = 500;
    const productIds: Array<{ id: string; name: string; priceCents: number; costCents: number }> = [];
    for (const p of DEMO_PRODUCTS) {
      const created = await tx.playlandProduct.create({
        data: {
          orgId,
          branchId,
          kind: "SALE_ITEM",
          name: p.name,
          category: p.category,
          sku: DEMO_TAG, // ตรา DEMO (ค้น/ล้างทีหลัง)
          barcode: `${DEMO_BARCODE_PREFIX}${sort}`, // unique ต่อสาขา (มี @@unique([branchId, barcode]))
          priceCents: p.priceBaht * 100,
          costCents: p.costBaht * 100,
          stock: p.stock,
          reorderLevel: p.reorder,
          active: true,
          sortOrder: sort++,
        },
        select: { id: true, name: true, priceCents: true, costCents: true },
      });
      productIds.push({ id: created.id, name: created.name, priceCents: created.priceCents, costCents: created.costCents ?? 0 });
      productsCreated++;
    }

    // ── 2) กะตัวอย่าง 1 กะ (OPEN) — ผูกยอดวันนี้เข้ากะ → "กะยังไม่ปิด" + สรุปกะมีตัวเลข ──
    const shift = await tx.playlandShift.create({
      data: {
        orgId,
        branchId,
        cashierUserId: userId,
        shiftCode: newShiftCode(),
        openingCashCents: 200000, // ฿2,000 เงินทอนเปิดร้าน
        status: "OPEN",
        notes: DEMO_TAG, // ตรา DEMO
      },
      select: { id: true },
    });

    // ── 3) ยอดขาย 14 วัน ────────────────────────────────────────────────
    // แต่ละวัน: ค่าเข้า/ต่อเวลา (ENTRY = ไม่มี line) หลายบิล + ขายของ (PRODUCT = มี line) หลายบิล
    // เสาร์-อาทิตย์ยอดสูงกว่า → กราฟแท่งซ้อนเห็นเทรนด์จริง
    for (let dayBack = 13; dayBack >= 0; dayBack--) {
      const day = new Date(todayStart);
      day.setDate(day.getDate() - dayBack);
      const dow = day.getDay(); // 0=อา 6=ส
      const isWeekend = dow === 0 || dow === 6;
      const isToday = dayBack === 0;

      // วันนี้ผูกบิลเข้ากะ (shiftId) → สรุปกะ/ลิ้นชักมีตัวเลข · วันย้อนหลังไม่ผูกกะ (shiftId: null)
      const shiftIdForDay = isToday ? shift.id : null;

      // จำนวนบิลต่อวัน — weekend เยอะกว่า · วันนี้การันตีหลายบิลทั้งสองชนิด (ทุก KPI ไม่เป็นศูนย์)
      const entryBills = (isWeekend ? 7 : 4) + (isToday ? 2 : 0);
      const productBills = (isWeekend ? 6 : 3) + (isToday ? 2 : 0);

      // 3a) ENTRY/TIME sales (ไม่มี line → นับเป็น "ค่าเข้า · เวลา")
      for (let i = 0; i < entryBills; i++) {
        const soldAt = new Date(day);
        soldAt.setHours(10 + (i % 10), (i * 13) % 60, (i * 7) % 60, 0); // กระจายเวลาในวัน
        const priceBaht = pick(ENTRY_PRICES_BAHT, i + dayBack);
        await tx.playlandSale.create({
          data: {
            orgId,
            branchId,
            shiftId: shiftIdForDay,
            saleCode: newSaleCode(),
            totalCents: priceBaht * 100,
            paymentMethod: pick(PAY_METHODS, i),
            paymentRef: DEMO_TAG, // ตรา DEMO
            cashierUserId: userId,
            soldAt,
          },
        });
        salesCreated++;
      }

      // 3b) PRODUCT sales (มี sale_lines → นับเป็น "ขายของ" + ป้อน "ขนมขายดี")
      for (let i = 0; i < productBills; i++) {
        const soldAt = new Date(day);
        soldAt.setHours(11 + (i % 9), (i * 17 + 5) % 60, (i * 11) % 60, 0);
        // 1-3 รายการ/บิล · เลือกสินค้าหลายตัวให้ "ขนมขายดี" วันนี้กระจาย
        const lineCount = 1 + (i % 3);
        const lines: Prisma.PlaylandSaleLineCreateWithoutSaleInput[] = [];
        let total = 0;
        for (let j = 0; j < lineCount; j++) {
          const prod = pick(productIds, i * 3 + j + dayBack);
          const qty = 1 + ((i + j) % 3);
          const lineCents = prod.priceCents * qty;
          total += lineCents;
          lines.push({
            orgId,
            product: { connect: { id: prod.id } },
            productName: prod.name,
            quantity: qty,
            unitCents: prod.priceCents,
            lineCents,
          });
        }
        await tx.playlandSale.create({
          data: {
            orgId,
            branchId,
            shiftId: shiftIdForDay,
            saleCode: newSaleCode(),
            totalCents: total,
            paymentMethod: pick(PAY_METHODS, i + 1),
            paymentRef: DEMO_TAG, // ตรา DEMO
            cashierUserId: userId,
            soldAt,
            lines: { create: lines },
          },
        });
        salesCreated++;
        saleLinesCreated += lines.length;
      }
    }

    // ── 4) สมาชิกตัวอย่าง (สร้างวันนี้ → "สมาชิกใหม่" > 0) + session กำลังเล่นบางคน ──
    for (const m of DEMO_MEMBERS) {
      const member = await tx.playlandMember.create({
        data: {
          orgId,
          branchId,
          memberCode: newMemberCode(),
          type: m.type,
          name: m.name,
          nickname: m.nickname,
          notes: DEMO_TAG, // ตรา DEMO
          consentAt: new Date(),
          lastVisitAt: new Date(),
          // createdAt = now() ตาม default → ตกวันนี้ → นับเป็นสมาชิกใหม่
        },
        select: { id: true },
      });
      membersCreated++;

      // บางคน "กำลังเล่นตอนนี้" → PlaylandSession status ACTIVE, checkInAt วันนี้
      // (สร้าง standalone ได้ — model ไม่บังคับ packageId · packageMinutes/packagePriceCents เป็น Int NOT NULL จึงใส่ค่า)
      if (m.active) {
        const checkInAt = new Date(); // เพิ่งเข้ามาเล่น
        const expiresAt = new Date(checkInAt.getTime() + 60 * 60_000); // เหลือเวลา 60 นาที
        await tx.playlandSession.create({
          data: {
            orgId,
            branchId,
            memberId: member.id,
            packageMinutes: 60,
            packagePriceCents: 8000, // ฿80
            status: "ACTIVE",
            checkInAt,
            expiresAt,
            cashierUserId: userId,
            notes: DEMO_TAG, // ตรา DEMO
          },
        });
        sessionsCreated++;
      }
    }
  }, { timeout: 30_000 });

  revalidatePath("/playland/office");
  revalidatePath("/playland/reports");
  revalidatePath("/playland/stock");
  revalidatePath("/playland");
  return {
    ok: true,
    data: { products: productsCreated, sales: salesCreated, saleLines: saleLinesCreated, members: membersCreated, sessions: sessionsCreated },
  };
}

// ============================================================================
// CLEAR — ล้างเฉพาะข้อมูลตัวอย่าง (ติดตรา DEMO) ของสาขานี้ · ของจริงไม่แตะ
// ============================================================================
export async function clearDemoData(input: { branchId: string }): Promise<ActionResult<{
  products: number; sales: number; sessions: number; members: number; shifts: number;
}>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์ · ต้องเป็นผู้จัดการขึ้นไป");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  const counts = await clearDemoRows(session.user.org_id, input.branchId);

  revalidatePath("/playland/office");
  revalidatePath("/playland/reports");
  revalidatePath("/playland/stock");
  revalidatePath("/playland");
  return { ok: true, data: counts };
}

// ── ลบแถวตรา DEMO ตามลำดับ FK (lines → sales → sessions → members → shift → products) ──
// แชร์โดย seedDemoData (เคลียร์ก่อนเติม) + clearDemoData
async function clearDemoRows(orgId: string, branchId: string): Promise<{
  products: number; sales: number; sessions: number; members: number; shifts: number;
}> {
  return prisma.$transaction(async (tx) => {
    // sale_lines ลบอัตโนมัติ (onDelete: Cascade จาก sales) — ลบ sales ติดตรา DEMO ก็พอ
    const sales = await tx.playlandSale.deleteMany({ where: { orgId, branchId, paymentRef: DEMO_TAG } });
    const sessions = await tx.playlandSession.deleteMany({ where: { orgId, branchId, notes: DEMO_TAG } });
    const members = await tx.playlandMember.deleteMany({ where: { orgId, branchId, notes: DEMO_TAG } });
    const shifts = await tx.playlandShift.deleteMany({ where: { orgId, branchId, notes: DEMO_TAG } });
    // products: stock_movements/sale_lines ที่อ้างถึงถูกลบไปแล้ว (sale cascade) → ลบสินค้า DEMO ได้
    const products = await tx.playlandProduct.deleteMany({
      where: { orgId, branchId, sku: DEMO_TAG, barcode: { startsWith: DEMO_BARCODE_PREFIX } },
    });
    return {
      products: products.count, sales: sales.count, sessions: sessions.count,
      members: members.count, shifts: shifts.count,
    };
  }, { timeout: 30_000 });
}
