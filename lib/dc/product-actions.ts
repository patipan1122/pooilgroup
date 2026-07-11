"use server";

// DC Warehouse · PRODUCTS master — server actions (create/update/toggle/seed).
//
// ทุก action: requireSession + canDcManage(role) (ไม่ผ่าน = throw) · scope ทุก
// query ด้วย orgId เสมอ · revalidate หน้าทะเบียนสินค้า. Result pattern:
// {ok:true,...} | {ok:false,error}. ไม่มีเรื่องเงินในไฟล์นี้.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { DcProductType } from "@/lib/generated/prisma/enums";

const PRODUCTS_PATH = "/dc/office/products";

function errCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

/** Guard: ต้อง login + มีสิทธิ์ manage หลังบ้าน DC. คืน {orgId, userId}. */
async function requireManager(): Promise<{ orgId: string; userId: string }> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์จัดการทะเบียนสินค้า");
  }
  return { orgId: session.user.org_id, userId: session.user.id };
}

export type ProductActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type CreateProductInput = {
  sku: string;
  name: string;
  barcode?: string | null;
  type: DcProductType;
  unit?: string | null;
  category?: string | null;
  reorderPoint?: number | null;
  imageR2Path?: string | null;
};

export type UpdateProductInput = CreateProductInput;

function normType(t: DcProductType): DcProductType {
  return t === DcProductType.SPARE ? DcProductType.SPARE : DcProductType.SALE;
}

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** สร้างสินค้าใหม่ · sku ต้องไม่ซ้ำใน org (P2002 → ข้อความเตือนแบบเป็นมิตร) */
export async function createProduct(input: CreateProductInput): Promise<ProductActionResult> {
  const { orgId } = await requireManager();

  const sku = cleanStr(input.sku);
  const name = cleanStr(input.name);
  if (!sku) return { ok: false, error: "กรุณากรอกรหัสสินค้า (SKU)" };
  if (!name) return { ok: false, error: "กรุณากรอกชื่อสินค้า" };

  try {
    const product = await prisma.dcProduct.create({
      data: {
        orgId,
        sku,
        name,
        barcode: cleanStr(input.barcode),
        type: normType(input.type),
        unit: cleanStr(input.unit) ?? "ชิ้น",
        category: cleanStr(input.category),
        reorderPoint:
          input.reorderPoint == null || Number.isNaN(input.reorderPoint)
            ? null
            : Math.max(0, Math.trunc(input.reorderPoint)),
        imageR2Path: cleanStr(input.imageR2Path),
        active: true,
      },
      select: { id: true },
    });
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, id: product.id };
  } catch (e) {
    if (errCode(e) === "P2002") {
      return { ok: false, error: `มีสินค้ารหัส "${sku}" อยู่แล้ว — ใช้รหัสอื่น` };
    }
    return { ok: false, error: "บันทึกสินค้าไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/** แก้ไขสินค้าของ org ตัวเอง (scope ด้วย orgId กัน cross-org) */
export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductActionResult> {
  const { orgId } = await requireManager();

  const sku = cleanStr(input.sku);
  const name = cleanStr(input.name);
  if (!sku) return { ok: false, error: "กรุณากรอกรหัสสินค้า (SKU)" };
  if (!name) return { ok: false, error: "กรุณากรอกชื่อสินค้า" };

  // ตรวจว่าสินค้าเป็นของ org นี้ก่อน (updateMany scope กัน update ข้ามองค์กร)
  const existing = await prisma.dcProduct.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบสินค้านี้ในองค์กรของคุณ" };

  try {
    await prisma.dcProduct.update({
      where: { id },
      data: {
        sku,
        name,
        barcode: cleanStr(input.barcode),
        type: normType(input.type),
        unit: cleanStr(input.unit) ?? "ชิ้น",
        category: cleanStr(input.category),
        reorderPoint:
          input.reorderPoint == null || Number.isNaN(input.reorderPoint)
            ? null
            : Math.max(0, Math.trunc(input.reorderPoint)),
        imageR2Path: cleanStr(input.imageR2Path),
      },
      select: { id: true },
    });
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, id };
  } catch (e) {
    if (errCode(e) === "P2002") {
      return { ok: false, error: `มีสินค้ารหัส "${sku}" อยู่แล้ว — ใช้รหัสอื่น` };
    }
    return { ok: false, error: "แก้ไขสินค้าไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/** เปิด/ปิดการใช้งานสินค้า (soft) ของ org ตัวเอง */
export async function toggleProductActive(
  id: string,
  active: boolean,
): Promise<ProductActionResult> {
  const { orgId } = await requireManager();
  const res = await prisma.dcProduct.updateMany({
    where: { id, orgId },
    data: { active },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบสินค้านี้ในองค์กรของคุณ" };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, id };
}

/**
 * ตั้ง/เปลี่ยน "รูปสินค้า" อย่างเดียว (ใช้จากหน้าหน้าบ้าน — พนักงานถ่ายรูปของจริง).
 * เบา ๆ: ไม่ต้องส่งฟิลด์อื่นครบเหมือน updateProduct · scope ด้วย orgId (กันข้ามองค์กร).
 * ต้อง login (requireSession) — ไม่บังคับสิทธิ์ manage เพราะเป็นงานหน้าร้านของ floor staff.
 */
export async function setProductImage(
  productId: string,
  imageR2Path: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const res = await prisma.dcProduct.updateMany({
    where: { id: productId, orgId },
    data: { imageR2Path: cleanStr(imageR2Path) },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบสินค้านี้ในองค์กรของคุณ" };

  revalidatePath(`/dc/products/${productId}`);
  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

// ---- ตัวอย่างสินค้า (demo seed) ----
type SeedRow = {
  sku: string;
  name: string;
  type: DcProductType;
  unit: string;
  reorderPoint: number;
};

const SAMPLE_PRODUCTS: SeedRow[] = [
  // ขนม/เครื่องดื่ม (SALE)
  { sku: "SNK-001", name: "เลย์ รสออริจินอล", type: DcProductType.SALE, unit: "ห่อ", reorderPoint: 24 },
  { sku: "SNK-002", name: "น้ำเปล่าสิงห์ 600 มล.", type: DcProductType.SALE, unit: "ขวด", reorderPoint: 48 },
  { sku: "SNK-003", name: "นมโฟร์โมสต์ รสจืด", type: DcProductType.SALE, unit: "กล่อง", reorderPoint: 36 },
  { sku: "SNK-004", name: "ไอติมวอลล์ คอร์นเนตโต้", type: DcProductType.SALE, unit: "แท่ง", reorderPoint: 20 },
  { sku: "SNK-005", name: "หมากฝรั่ง", type: DcProductType.SALE, unit: "ซอง", reorderPoint: 30 },
  { sku: "SNK-006", name: "ขนมปัง", type: DcProductType.SALE, unit: "แพ็ค", reorderPoint: 15 },
  // อะไหล่ (SPARE)
  { sku: "SPR-001", name: "มอเตอร์ตู้คีบ", type: DcProductType.SPARE, unit: "ตัว", reorderPoint: 4 },
  { sku: "SPR-002", name: "สายพาน", type: DcProductType.SPARE, unit: "เส้น", reorderPoint: 6 },
  { sku: "SPR-003", name: "หลอด LED", type: DcProductType.SPARE, unit: "หลอด", reorderPoint: 10 },
  { sku: "SPR-004", name: "สายรัด RFID", type: DcProductType.SPARE, unit: "เส้น", reorderPoint: 50 },
  { sku: "SPR-005", name: "ฟิวส์", type: DcProductType.SPARE, unit: "ตัว", reorderPoint: 20 },
  { sku: "SPR-006", name: "น็อตชุด", type: DcProductType.SPARE, unit: "ชุด", reorderPoint: 8 },
];

/** สุ่มบาร์โค้ดตัวเลข 13 หลัก (สตริง) */
function randomBarcode13(): string {
  let s = "";
  for (let i = 0; i < 13; i++) s += Math.floor(Math.random() * 10).toString();
  return s;
}

export type SeedResult =
  | { ok: true; created: number }
  | { ok: false; error: string };

/**
 * เพิ่มสินค้าตัวอย่าง ~12 รายการ · idempotent: ข้าม sku ที่มีอยู่แล้ว
 * (กดซ้ำได้ ผลเหมือนเดิม). คืนจำนวนที่สร้างใหม่จริง.
 */
export async function seedSampleProducts(): Promise<SeedResult> {
  const { orgId } = await requireManager();

  // ดึง sku ที่มีอยู่แล้วใน org รอบเดียว แล้ว filter (กันสร้างซ้ำ)
  const existing = await prisma.dcProduct.findMany({
    where: { orgId, sku: { in: SAMPLE_PRODUCTS.map((p) => p.sku) } },
    select: { sku: true },
  });
  const have = new Set(existing.map((e) => e.sku));
  const toCreate = SAMPLE_PRODUCTS.filter((p) => !have.has(p.sku));

  if (toCreate.length === 0) {
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, created: 0 };
  }

  try {
    const result = await prisma.dcProduct.createMany({
      data: toCreate.map((p) => ({
        orgId,
        sku: p.sku,
        name: p.name,
        barcode: randomBarcode13(),
        type: p.type,
        unit: p.unit,
        reorderPoint: p.reorderPoint,
        active: true,
      })),
      skipDuplicates: true, // กัน race: insert พร้อมกัน 2 ครั้ง → ตัวซ้ำถูกข้าม
    });
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, created: result.count };
  } catch {
    return { ok: false, error: "เพิ่มสินค้าตัวอย่างไม่สำเร็จ ลองอีกครั้ง" };
  }
}
