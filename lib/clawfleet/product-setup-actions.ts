"use server";

// ClawFleet · ตู้คีบ OS — N1b "เพิ่มสินค้าใหม่ตอนตั้งค่าตู้ครั้งแรก" (MONEY/STOCK-SENSITIVE)
// -----------------------------------------------------------------------------
// ทำไมมี (CEO 2026-07-12):
//   ตู้เก่าที่เพิ่งลงระบบมักมี "ตุ๊กตาเก่าอยู่ในตู้แล้ว" ที่ไม่เคยอยู่ในทะเบียนสินค้า.
//   ตอน "ตั้งค่าตู้ครั้งแรก" (first-time setup) แม่บ้าน/พนักงานสาขา ถ่ายรูป + ตั้งชื่อ+SKU +
//   นับว่ามีในตู้กี่ตัว → ระบบสร้างสินค้าใหม่ + บันทึกยอด "ในตู้" ตั้งต้น (ไม่มีต้นทุน).
//   ต้นทุนจริงมาทีหลังจากการรับเข้า DC (receiving) — พนักงานไม่รู้ต้นทุน → ห้ามกรอก/ห้ามเขียนต้นทุน.
//
// สิทธิ์ (CEO decision):
//   - "ตอนตั้งค่าครั้งแรก" (ตู้ยัง !isFirstBaselineLocked) + เป็นพนักงานสมาชิกจริงของสาขานั้น → เพิ่มได้
//   - "เวลาอื่น" (ตู้ตั้งค่าไปแล้ว) → ต้องผู้จัดการ/แอดมิน (approval) เท่านั้น
//   → gate ที่ server เสมอ (ไม่ใช่แค่ซ่อนปุ่มใน UI).
//
// money/stock invariant (mirror lib/clawfleet/actions.ts LOAD_TO_MACHINE + stock-actions returnDolls):
//   "ในตู้" ของสินค้า = |Σ qty ของแถวที่ machineId = ตู้นี้ + productId นี้| (ดู stock-queries.ts:132-152).
//   refill LOAD_TO_MACHINE เขียน qty เป็น "ลบ" (actions.ts:447) → |Σ| = จำนวนในตู้.
//   opening ของเราต้องได้ semantics เดียวกัน → เขียน type=LOAD_TO_MACHINE, qty = −qty, machineId=ตู้.
//   ⚠️ warehouseId = null และ "ไม่หักคลัง" — ตุ๊กตาเก่าอยู่ในตู้อยู่แล้ว ไม่ได้หยิบจากชั้นคลัง
//   (ต่างจาก refill ที่หักของบนชั้น). เราแค่ประกาศ "ในตู้มีของตั้งต้นเท่านี้" → ไม่มี over-issue guard.
//
// idempotency (double-tap / offline retry ต้องไม่ได้ 2 สินค้า หรือ 2× ตุ๊กตา):
//   clientKey (UUID จาก client · 1 ครั้ง/กด) → เก็บใน movement.refId (refTable='cf_setup_product').
//   advisory-lock (branch, sku) ก่อนเขียน → serialize การกดพร้อมกัน → findFirst dedup แล้วค่อยสร้าง
//   (mirror returnDollsToStock stock-actions.ts:1608-1630). ซ้ำ → คืนผลเดิม (สินค้าเดิม · ยอดเดิม).
//   สร้างสินค้า + movement ใน $transaction เดียว → ถ้าชื่อ/SKU ชน (P2002) tx rollback ทั้งก้อน
//   → ไม่มี movement กำพร้า (orphan). ต้นทุนเป็น 0 เสมอ → ไม่ชน cost>0 guard ใด ๆ.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCfSession, isCfAdmin, isCfBranchManager, isCfStaff, cfHasAdminPower } from "./role-guard";
import { getBranchMainWarehouseId } from "./stock-queries";
import { PRODUCT_CATEGORIES } from "./types";

const APP_PATHS = [
  "/clawfleet/os/app",
  "/clawfleet/os/stock",
  "/liff/clawfleet",
];

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

const AddSetupProductSchema = z.object({
  machineId: z.string().uuid("ไม่ระบุตู้"),
  branchId: z.string().uuid("ไม่ระบุสาขา"),
  name: z.string().trim().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  sku: z.string().trim().min(1, "กรุณากรอกรหัส SKU").max(80),
  imageUrl: z.string().trim().url("ลิงก์รูปไม่ถูกต้อง").max(1000).optional(),
  qty: z.number().int("จำนวนต้องเป็นจำนวนเต็ม").positive("จำนวนตุ๊กตาต้องมากกว่า 0").max(100_000),
  // client-generated UUID ต่อการกด 1 ครั้ง (refId เป็น @db.Uuid) → กันกดซ้ำ (double-tap)
  clientKey: z.string().uuid("clientKey ไม่ถูกต้อง"),
});

export type AddSetupProductInput = z.input<typeof AddSetupProductSchema>;

const SETUP_REF_TABLE = "cf_setup_product";

/**
 * เพิ่มสินค้าใหม่ (SKU) + บันทึกตุ๊กตาตั้งต้น "ในตู้" ระหว่าง "ตั้งค่าตู้ครั้งแรก".
 *
 * ทำใน $transaction เดียว (atomic · ไม่มี half-written):
 *   1) advisory-lock (branch, sku) — serialize การเพิ่มซ้อน/กดพร้อมกัน
 *   2) idempotency: มี movement cf_setup_product ที่ refId=clientKey แล้ว → คืนผลเดิม (no-op)
 *   3) สร้าง CfProduct { name, sku, imageUrl, unitCostCents:0, defaultPriceCoins default }
 *      → SKU ชน [orgId,sku] = P2002 → ข้อความเป็นมิตร "มี SKU นี้แล้ว"
 *   4) เขียน 1 opening movement { type:LOAD_TO_MACHINE, qty:−qty, machineId, warehouseId:null,
 *      unitCostCents:0, refTable:cf_setup_product, refId:clientKey } → "ในตู้" = |Σ| = qty
 *   5) เปิดแถว CfMachineLoadout (effectiveTo=null) ให้สินค้าใหม่เป็นของในตู้ (ถ้ายังไม่มี)
 *   6) audit_log
 *
 * สิทธิ์: (ตู้ยังไม่ล็อก baseline + เป็นพนักงานสมาชิกจริงของสาขา) หรือ (ผู้จัดการ/แอดมิน).
 */
export async function addSetupProductWithDolls(
  input: AddSetupProductInput,
): Promise<Result<{ productId: string; inMachineAfter: number }>> {
  const parsed = AddSetupProductSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // โหลดตู้ (org scope) — ต้องอยู่ในสาขาที่ระบุ (กัน spoof machineId ข้ามสาขา)
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId, branchId: data.branchId },
    select: { id: true, branchId: true, isFirstBaselineLocked: true },
  });
  if (!machine) return err("ไม่พบตู้ในสาขานี้");

  // ── สิทธิ์ (SERVER-SIDE · CEO decision) ─────────────────────────────────────
  // อนุญาตถ้า: (ตู้ยัง "ตั้งค่าครั้งแรก" = ยังไม่ล็อก baseline) และเป็นพนักงานสมาชิกจริงของสาขานั้น
  //   หรือ เป็นผู้จัดการ/แอดมิน (canManage) — จัดการได้ทุกเวลา.
  // ⚠️ ห้าม gate ด้วย userBranchIds()==='ALL' (viewer ก็ได้ 'ALL') → เช็ก membership จริง (UserBranch).
  const canManage = isCfAdmin(session.user.role) || isCfBranchManager(session.user.role) || (await cfHasAdminPower(session));
  let allowed = canManage;
  if (!allowed) {
    // พนักงานสมาชิกจริงของสาขา (isCfStaff + UserBranch) และตู้ยังตั้งค่าครั้งแรกอยู่เท่านั้น
    if (!machine.isFirstBaselineLocked && isCfStaff(session.user.role)) {
      const ub = await prisma.userBranch.findFirst({
        where: { userId: session.user.id, branchId: machine.branchId },
        select: { id: true },
      });
      allowed = !!ub;
    }
  }
  if (!allowed) {
    return err(
      "เพิ่มสินค้าใหม่ได้เฉพาะตอนตั้งค่าตู้ครั้งแรก · หลังจากนั้นต้องให้ผู้จัดการอนุมัติ",
    );
  }

  // sanitize
  const name = data.name.trim();
  const sku = data.sku.trim();
  if (!name) return err("กรุณากรอกชื่อสินค้า");
  if (!sku) return err("กรุณากรอกรหัส SKU");

  // ── SKU dedup ก่อนเข้า tx (ข้อความเป็นมิตร) — unique [orgId,sku] เป็นด่านสุดท้ายใน tx ด้วย ──
  const dupSku = await prisma.cfProduct.findFirst({
    where: { orgId, sku },
    select: { id: true },
  });
  if (dupSku) return err("รหัส SKU นี้มีอยู่แล้ว เลือกจากรายการที่มี");

  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";
  const now = new Date();
  // คลังหลักของสาขา — stamp บนแถว "ยอดเข้าคลัง (+N)" ให้ scope ตรงกับ RECEIPT_IN (null = ยังไม่มี main = main)
  const mainWarehouseId = await getBranchMainWarehouseId(orgId, machine.branchId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1) 🔒 advisory-lock (branch, sku) — serialize การเพิ่มพร้อมกัน (อ่าน dedup→เขียน กันซ้ำ)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machine.branchId}), hashtext(${sku}))`;

      // 2) idempotency: มี opening movement ที่ clientKey นี้แล้ว → คืนผลเดิม (double-tap / retry)
      const dup = await tx.cfStockMovement.findFirst({
        where: {
          orgId,
          branchId: machine.branchId,
          machineId: machine.id,
          refTable: SETUP_REF_TABLE,
          refId: data.clientKey,
        },
        select: { productId: true },
      });
      if (dup) {
        const cur = await tx.cfStockMovement.aggregate({
          where: { orgId, branchId: machine.branchId, machineId: machine.id, productId: dup.productId },
          _sum: { qty: true },
        });
        return { productId: dup.productId, inMachineAfter: Math.abs(cur._sum.qty ?? 0) };
      }

      // 3) สร้างสินค้าใหม่ — ไม่มีต้นทุน (unitCostCents:0) · ราคาขาย/กล่อง default.
      //    SKU ชน [orgId,sku] → P2002 → rollback ทั้ง tx (ไม่มี movement กำพร้า).
      const product = await tx.cfProduct.create({
        data: {
          orgId,
          sku,
          name,
          imageUrl: data.imageUrl ?? null,
          unitCostCents: 0, // ไม่มีต้นทุน — พนักงานไม่รู้ราคา (มาทีหลังจากการรับเข้า DC)
          // category / defaultPriceCoins ใช้ค่า default ของ schema (PLUSH / 1)
        },
        select: { id: true },
      });

      // 4) opening dolls-in-machine = 2 แถว "สมดุล" ให้ net-shelf = 0 (เหมือน refill ที่มี receipt +N นำ):
      //    (A) +N เข้าคลัง (ADJUST · ยอดตุ๊กตาเก่าเข้าระบบ · ไม่มีต้นทุน)  (B) −N โหลดเข้าตู้ (LOAD_TO_MACHINE)
      //    → net-shelf (Σ ทุกแถว) = 0 (ชั้นว่างจริง · ของอยู่ในตู้) · "ในตู้" = |Σ machineId=ตู้| = N
      //    ★ ถ้าเขียนแถวเดียว −N → net-shelf = −N "ผี" → บล็อกเติม/รับของครั้งหน้าเพี้ยน (M−N) — adversarial review เจอ
      //    idempotency: dedup (step 2) หาแถว machineId=ตู้ · 2 แถวเขียนใน tx เดียว → replay คืนผลเดิมทั้งคู่
      await tx.cfStockMovement.create({
        data: {
          orgId,
          branchId: machine.branchId,
          type: "ADJUST",
          productId: product.id,
          machineId: null,
          warehouseId: mainWarehouseId,
          qty: data.qty, // +N เข้าคลัง (ยอดตั้งต้น · ไม่มีต้นทุน)
          unitCostCents: 0,
          refTable: SETUP_REF_TABLE,
          refId: data.clientKey,
          occurredAt: now,
          createdById: session.user.id,
          reason: "ตั้งต้นตอนตั้งค่าตู้ครั้งแรก (ตุ๊กตาเก่าเข้าระบบ)",
        },
      });
      await tx.cfStockMovement.create({
        data: {
          orgId,
          branchId: machine.branchId,
          type: "LOAD_TO_MACHINE",
          productId: product.id,
          machineId: machine.id,
          warehouseId: null,
          qty: -data.qty, // −N → |Σ machineId=ตู้| = N (semantics เดียวกับ refill)
          unitCostCents: 0,
          refTable: SETUP_REF_TABLE,
          refId: data.clientKey,
          occurredAt: now,
          createdById: session.user.id,
          reason: "ตั้งต้นตอนตั้งค่าตู้ครั้งแรก (โหลดเข้าตู้)",
        },
      });

      // 5) เปิดแถว loadout ให้สินค้าใหม่เป็นของในตู้ (รองรับหลาย SKU ต่อตู้ — ไม่ปิดของเดิม).
      //    เช็คก่อนว่ามีแถว current (effectiveTo=null) ของสินค้านี้ในตู้แล้วหรือยัง (กันซ้ำถ้า replay หลุด lock).
      const existingLoadout = await tx.cfMachineLoadout.findFirst({
        where: { orgId, machineId: machine.id, productId: product.id, effectiveTo: null },
        select: { id: true },
      });
      if (!existingLoadout) {
        await tx.cfMachineLoadout.create({
          data: {
            orgId,
            machineId: machine.id,
            productId: product.id,
            pricePerPlayCoins: 1, // default · baseline สนใจ "มีสินค้าอะไรในตู้" · ราคาปรับทีหลัง
            effectiveFrom: now,
            effectiveTo: null,
            setById: session.user.id,
            notes: `เพิ่มสินค้าใหม่ตอนตั้งค่าตู้ครั้งแรก · จำนวน ${data.qty}`,
          },
        });
      }

      // 6) audit trail (anti-fraud · ใครเพิ่มสินค้า/ยอดตั้งต้นเท่าไร)
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_SETUP_PRODUCT_ADDED",
          resourceType: "CF_PRODUCT",
          resourceId: product.id,
          diff: {
            machineId: machine.id,
            branchId: machine.branchId,
            addedBy: byName,
            sku,
            name,
            qty: data.qty,
            firstSetup: !machine.isFirstBaselineLocked,
          },
        },
      });

      return { productId: product.id, inMachineAfter: data.qty };
    });

    for (const p of APP_PATHS) revalidatePath(p);
    return { ok: true, data: result };
  } catch (e) {
    // P2002 = ชน unique [orgId,sku] (มีคนสร้าง SKU นี้ไปก่อนพร้อมกัน) → เป็นมิตร
    if ((e as { code?: string }).code === "P2002") {
      return err("รหัส SKU นี้มีอยู่แล้ว เลือกจากรายการที่มี");
    }
    return err(`เพิ่มสินค้าไม่สำเร็จ: ${(e as Error).message}`);
  }
}

// -----------------------------------------------------------------------------
// N1c (CEO 2026-07-13) · บันทึกจำนวนตุ๊กตา "ในตู้" ตอนตั้งค่าครั้งแรก สำหรับสินค้าที่
// มี SKU อยู่แล้ว (ไม่สร้าง product ใหม่ · ต่างจาก addSetupProductWithDolls).
// ใช้ตอน CEO อยากกรอก "ตุ๊กตาในตู้ตอนนี้" เป็นรายการ SKU (หมี 3 · กระต่าย 4) แทนเลขรวม.
//
// money/stock: เขียน 2 แถวสมดุลเหมือน addSetupProductWithDolls (ADJUST +N คลัง / LOAD −N ตู้)
//   → "ในตู้" = N · net-shelf = 0. ADD-ONCE ต่อสินค้า (ตู้ baseline ว่าง — ไม่รองรับแก้จำนวน:
//   ถ้าสินค้ามีในตู้อยู่แล้ว (Σ≠0) → ปฏิเสธ กันสแต็กซ้ำ). idempotent ด้วย clientKey.
// -----------------------------------------------------------------------------
const AddExistingSetupSchema = z.object({
  machineId: z.string().uuid("ไม่ระบุตู้"),
  branchId: z.string().uuid("ไม่ระบุสาขา"),
  productId: z.string().uuid("ไม่ระบุสินค้า"),
  qty: z.number().int("จำนวนต้องเป็นจำนวนเต็ม").positive("จำนวนตุ๊กตาต้องมากกว่า 0").max(100_000),
  clientKey: z.string().uuid("clientKey ไม่ถูกต้อง"),
});
export type AddExistingSetupInput = z.input<typeof AddExistingSetupSchema>;

export async function addExistingProductDollsAtSetup(
  input: AddExistingSetupInput,
): Promise<Result<{ productId: string; inMachineAfter: number }>> {
  const parsed = AddExistingSetupSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId, branchId: data.branchId },
    select: { id: true, branchId: true, isFirstBaselineLocked: true },
  });
  if (!machine) return err("ไม่พบตู้ในสาขานี้");

  // สิทธิ์ (เหมือน addSetupProductWithDolls · gate ที่ server เสมอ)
  const canManage =
    isCfAdmin(session.user.role) || isCfBranchManager(session.user.role) || (await cfHasAdminPower(session));
  let allowed = canManage;
  if (!allowed && !machine.isFirstBaselineLocked && isCfStaff(session.user.role)) {
    const ub = await prisma.userBranch.findFirst({
      where: { userId: session.user.id, branchId: machine.branchId },
      select: { id: true },
    });
    allowed = !!ub;
  }
  if (!allowed) {
    return err("บันทึกตุ๊กตาในตู้ได้เฉพาะตอนตั้งค่าตู้ครั้งแรก · หลังจากนั้นต้องให้ผู้จัดการอนุมัติ");
  }

  // สินค้าต้องอยู่ในทะเบียนของ org นี้
  const product = await prisma.cfProduct.findFirst({
    where: { id: data.productId, orgId },
    select: { id: true },
  });
  if (!product) return err("ไม่พบสินค้านี้ในทะเบียน");

  const mainWarehouseId = await getBranchMainWarehouseId(orgId, machine.branchId);
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // advisory-lock (branch, productId) — serialize การกดพร้อมกัน
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machine.branchId}), hashtext(${data.productId}))`;

      // idempotency: clientKey นี้เขียนไปแล้ว → คืนผลเดิม
      const dup = await tx.cfStockMovement.findFirst({
        where: {
          orgId,
          branchId: machine.branchId,
          machineId: machine.id,
          refTable: SETUP_REF_TABLE,
          refId: data.clientKey,
        },
        select: { productId: true },
      });
      if (dup) {
        const cur = await tx.cfStockMovement.aggregate({
          where: { orgId, branchId: machine.branchId, machineId: machine.id, productId: dup.productId },
          _sum: { qty: true },
        });
        return { productId: dup.productId, inMachineAfter: Math.abs(cur._sum.qty ?? 0) };
      }

      // กันสแต็ก: สินค้านี้มีในตู้อยู่แล้ว (Σ machineId=ตู้ ≠ 0) → ปฏิเสธ (ตู้ baseline ควรว่าง)
      const already = await tx.cfStockMovement.aggregate({
        where: { orgId, branchId: machine.branchId, machineId: machine.id, productId: data.productId },
        _sum: { qty: true },
      });
      if (Math.abs(already._sum.qty ?? 0) !== 0) {
        throw new Error("สินค้านี้มีในตู้อยู่แล้ว");
      }

      // 2 แถวสมดุล (เหมือน addSetupProductWithDolls)
      await tx.cfStockMovement.create({
        data: {
          orgId, branchId: machine.branchId, type: "ADJUST", productId: data.productId,
          machineId: null, warehouseId: mainWarehouseId, qty: data.qty, unitCostCents: 0,
          refTable: SETUP_REF_TABLE, refId: data.clientKey, occurredAt: now,
          createdById: session.user.id, reason: "ตั้งต้นตอนตั้งค่าตู้ครั้งแรก (ตุ๊กตาเก่าเข้าระบบ)",
        },
      });
      await tx.cfStockMovement.create({
        data: {
          orgId, branchId: machine.branchId, type: "LOAD_TO_MACHINE", productId: data.productId,
          machineId: machine.id, warehouseId: null, qty: -data.qty, unitCostCents: 0,
          refTable: SETUP_REF_TABLE, refId: data.clientKey, occurredAt: now,
          createdById: session.user.id, reason: "ตั้งต้นตอนตั้งค่าตู้ครั้งแรก (โหลดเข้าตู้)",
        },
      });

      const existingLoadout = await tx.cfMachineLoadout.findFirst({
        where: { orgId, machineId: machine.id, productId: data.productId, effectiveTo: null },
        select: { id: true },
      });
      if (!existingLoadout) {
        await tx.cfMachineLoadout.create({
          data: {
            orgId, machineId: machine.id, productId: data.productId, pricePerPlayCoins: 1,
            effectiveFrom: now, effectiveTo: null, setById: session.user.id,
            notes: `ตั้งค่าตู้ครั้งแรก · จำนวน ${data.qty}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          orgId, userId: session.user.id, action: "CF_SETUP_PRODUCT_DOLLS_SET",
          resourceType: "CF_PRODUCT", resourceId: data.productId,
          diff: { machineId: machine.id, branchId: machine.branchId, qty: data.qty, firstSetup: !machine.isFirstBaselineLocked },
        },
      });

      return { productId: data.productId, inMachineAfter: data.qty };
    });

    for (const p of APP_PATHS) revalidatePath(p);
    return { ok: true, data: result };
  } catch (e) {
    if ((e as Error).message === "สินค้านี้มีในตู้อยู่แล้ว") {
      return err("สินค้านี้มีในตู้อยู่แล้ว — ถ้าจำนวนผิดต้องแก้ที่ผู้จัดการ");
    }
    return err(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
  }
}

// -----------------------------------------------------------------------------
// N1d (CEO 2026-07-13) · "เพิ่ม SKU ใหม่ + แนบรูปเอง" ตอนเก็บเงิน (collect flow)
// -----------------------------------------------------------------------------
// ทำไมมี:
//   CfProduct.imageUrl มีในสคีมาแต่ "ไม่เคยมีโค้ดที่ไหนเขียนค่านี้เลย" (audit ยืนยัน 0 writer)
//   → รูปสินค้าทั้งหมดเป็น null. CEO อยากให้พนักงานสร้าง SKU ใหม่ + แนบรูปได้ทันทีหน้าตู้.
//
// นี่คือ "แค่ทะเบียนสินค้า" (pure catalog insert) — ต่างจาก addSetupProductWithDolls:
//   - ★ ไม่แตะ stock / loadout / movement / money เลย (MONEY-SAFE) → สร้างชื่อ SKU ในทะเบียนอย่างเดียว
//   - ★ key point: เขียน imageUrl ลง DB จริง (เส้นทาง write คอลัมน์ใหม่)
//   - การใส่ตุ๊กตา "ในตู้" เป็นคนละขั้น → ใช้ addExistingProductDollsAtSetup ต่อได้
//
// สิทธิ์ (mirror addSetupProductWithDolls · gate ที่ server เสมอ):
//   canManage (admin/ผู้จัดการ/admin-power) หรือ staff ที่เป็นสมาชิกจริงของสาขา (UserBranch).
//   ⚠️ ไม่ gate ด้วย userBranchIds()==='ALL' (viewer ได้ 'ALL' ด้วย) → เช็ก UserBranch membership จริง.
//
// idempotency: catalog ไม่มี movement ให้เก็บ clientKey → ใช้ unique [orgId,sku] เป็นตัว dedup
//   (double-tap ด้วย sku เดิม → คืนสินค้าเดิม ไม่ error). advisory-lock (org, sku) serialize การกดพร้อมกัน.
//   sku ที่ auto-gen → retry เมื่อชน (P2002) เหมือน DC quickCreateProduct.
// -----------------------------------------------------------------------------
const CreateBranchProductSchema = z.object({
  branchId: z.string().uuid("ไม่ระบุสาขา"),
  name: z.string().trim().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  sku: z.string().trim().max(80).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  // R2 url ที่ client อัปไว้แล้ว (ผ่าน POST /api/clawfleet/upload) หรือ "" ถ้าไม่มีรูป
  imageUrl: z.union([z.string().trim().url("ลิงก์รูปไม่ถูกต้อง").max(1000), z.literal("")]).optional(),
  priceCents: z.number().int().min(0, "ราคาต้องไม่ติดลบ").max(100_000_000).optional(),
  clientKey: z.string().uuid("clientKey ไม่ถูกต้อง").optional(),
});
export type CreateBranchProductInput = z.input<typeof CreateBranchProductSchema>;

/** SKU อัตโนมัติ: คำนำหน้าจากหมวด (ตัวอักษรล้วน ≤4) + รหัสสุ่ม (กันชนด้วย retry P2002). */
function autoCfSku(category: string): string {
  const letters = category.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const prefix = letters.length >= 2 ? `CF-${letters}` : "CF-SKU";
  // 6 อักขระสุ่ม A-Z0-9 (ไม่รวมตัวสับสน O/0/I/1) → พอกันชนภายใน retry 5 รอบ
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 6; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${rand}`;
}

/**
 * สร้างสินค้าใหม่ (SKU) ในทะเบียนของ org พร้อมแนบรูป — pure catalog insert.
 *
 * ★ MONEY-SAFE: ไม่แตะ stock / loadout / movement / mirror — สร้างแถว CfProduct อย่างเดียว.
 * ★ เขียน imageUrl ลง DB (เส้นทาง write คอลัมน์นี้ที่ก่อนหน้าไม่มีใครเขียน).
 *
 * สิทธิ์: canManage หรือ staff ที่มี UserBranch ของ branchId.
 * idempotency: unique [orgId,sku] — sku เดิม → คืนสินค้าเดิม (ไม่ error) · sku auto-gen → retry ชน.
 */
export async function createBranchProduct(
  input: CreateBranchProductInput,
): Promise<Result<{ id: string; sku: string; name: string; imageUrl: string | null }>> {
  const parsed = CreateBranchProductSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // ── สิทธิ์ (SERVER-SIDE · mirror addSetupProductWithDolls) ─────────────────
  // canManage → ได้ทุกเวลา. staff → ต้องเป็นสมาชิกจริงของสาขา (UserBranch) ที่ระบุ.
  // ⚠️ ไม่ใช้ userBranchIds()==='ALL' (viewer ก็ได้ 'ALL') → เช็ก membership จริง.
  const canManage =
    isCfAdmin(session.user.role) || isCfBranchManager(session.user.role) || (await cfHasAdminPower(session));
  let allowed = canManage;
  if (!allowed && isCfStaff(session.user.role)) {
    const ub = await prisma.userBranch.findFirst({
      where: { userId: session.user.id, branchId: data.branchId },
      select: { id: true },
    });
    allowed = !!ub;
  }
  if (!allowed) return err("ไม่มีสิทธิ์เพิ่มสินค้าให้สาขานี้");

  // branch ต้องเป็นของ org นี้ (กัน spoof branchId ข้าม org)
  const branch = await prisma.branch.findFirst({
    where: { id: data.branchId, orgId },
    select: { id: true },
  });
  if (!branch) return err("ไม่พบสาขานี้");

  const name = data.name.trim();
  if (!name) return err("กรุณากรอกชื่อสินค้า");
  const category = data.category ?? "PLUSH";
  // "" (ไม่มีรูป) → null · url จริง → เก็บตามนั้น
  const imageUrl = data.imageUrl && data.imageUrl.length > 0 ? data.imageUrl : null;
  const explicitSku = data.sku?.trim() || "";

  try {
    // ── กรณีระบุ SKU เอง: dedup ก่อน (คืนของเดิมถ้ามี · idempotent) แล้วค่อยสร้าง ──
    if (explicitSku) {
      const existing = await prisma.cfProduct.findFirst({
        where: { orgId, sku: explicitSku },
        select: { id: true, sku: true, name: true, imageUrl: true },
      });
      if (existing) {
        // idempotent: SKU นี้มีแล้ว → คืนของเดิม (ไม่ error · double-tap / retry ปลอดภัย)
        return { ok: true, data: { id: existing.id, sku: existing.sku, name: existing.name, imageUrl: existing.imageUrl } };
      }
      const created = await prisma.$transaction(async (tx) => {
        // advisory-lock (org, sku) — serialize การกดพร้อมกันที่ sku เดียวกัน (อ่าน→เขียน)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${explicitSku}))`;
        const again = await tx.cfProduct.findFirst({
          where: { orgId, sku: explicitSku },
          select: { id: true, sku: true, name: true, imageUrl: true },
        });
        if (again) return again;
        return tx.cfProduct.create({
          data: {
            orgId,
            sku: explicitSku,
            name,
            category,
            imageUrl, // ★ เขียนรูปลง DB
            unitCostCents: 0, // ต้นทุนมาทีหลังจากการรับเข้า DC · พนักงานไม่รู้ราคา
            // defaultPriceCoins ใช้ default schema (1) · priceCents เป็นคนละหน่วย ไม่ map (ดู report)
          },
          select: { id: true, sku: true, name: true, imageUrl: true },
        });
      });
      revalidateAppPaths();
      return { ok: true, data: { id: created.id, sku: created.sku, name: created.name, imageUrl: created.imageUrl } };
    }

    // ── กรณี auto-gen SKU: retry เมื่อชน unique [orgId,sku] (P2002) สูงสุด 5 รอบ ──
    for (let attempt = 0; attempt < 5; attempt++) {
      const sku = autoCfSku(category);
      try {
        const created = await prisma.cfProduct.create({
          data: {
            orgId,
            sku,
            name,
            category,
            imageUrl, // ★ เขียนรูปลง DB
            unitCostCents: 0,
          },
          select: { id: true, sku: true, name: true, imageUrl: true },
        });
        revalidateAppPaths();
        return { ok: true, data: { id: created.id, sku: created.sku, name: created.name, imageUrl: created.imageUrl } };
      } catch (e) {
        if ((e as { code?: string }).code === "P2002" && attempt < 4) continue; // สุ่มชน → สุ่มใหม่
        throw e;
      }
    }
    return err("สร้างรหัส SKU ไม่สำเร็จ (ชนซ้ำ) · ลองอีกครั้ง");
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return err("รหัส SKU นี้มีอยู่แล้ว เลือกจากรายการที่มี");
    }
    return err(`เพิ่มสินค้าไม่สำเร็จ: ${(e as Error).message}`);
  }
}

function revalidateAppPaths(): void {
  for (const p of APP_PATHS) revalidatePath(p);
}
