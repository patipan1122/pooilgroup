// ClawFleet · แกลเลอรีตู้ (Machine Gallery) — read-only query layer (server-only).
//
// "เดินดูหน้าร้านจริง": เลือกสาขา → เห็นตู้ทุกตู้เป็นการ์ดพร้อมรูป · ขายอะไร · ราคาเล่น
//   · กดดูได้ว่ามี SKU อะไร กี่ตัว ทุนเท่าไร รวมทุนในตู้เท่าไร.
//
// แหล่งข้อมูล (อ่านอย่างเดียว · ไม่เขียน DB):
//   - รูปการ์ด  = รูปสต็อกหลังเติมล่าสุด (CfCollectionEvent.photoStockUrl · ที่ยังไม่ purge)
//                 → fallback รูปตู้เอง (CfMachine.photoUrl) → null (โชว์กรอบเปล่า)
//   - ราคาเล่น  = pricePerPlayCoins จาก loadout ปัจจุบัน (effectiveTo IS NULL) · 1 เหรียญ = 10 บาท
//   - SKU/จำนวน = Σ qty ใน cf_stock_movements ต่อ product เฉพาะ machineId นี้ (|Σ| = จำนวนในตู้)
//   - ทุน       = CfProduct.unitCostCents (สตางค์) · รวมทุนในตู้ = Σ(qty × unitCostCents)
//
// scope: orgId + สาขาที่ user เห็น (userBranchIds) — copy pattern จาก reports-queries/stock-queries.

import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds } from "./role-guard";

/** 1 เหรียญ = 10 บาท (ยืนยันจาก config-requests.ts:157 · queries-legacy.ts COIN_BAHT=10) */
const COIN_BAHT = 10;

/** ตัวเลือกสาขาใน dropdown ด้านบน */
export type GalleryBranchOption = {
  id: string;
  name: string;
  code: string;
  /** จำนวนตู้ที่ยัง active ในสาขานี้ (ในสโคป) */
  machineCount: number;
};

/** สินค้า 1 บรรทัดในตู้ */
export type GallerySku = {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  /** จำนวนที่อยู่ในตู้ตอนนี้ (|Σ movement qty| ของ machineId นี้) */
  qtyInMachine: number;
  /** ทุน/ตัว (สตางค์) · 0 = ยังไม่ตั้งทุน → client โชว์ "—" */
  unitCostCents: number;
  /** ทุนรวมบรรทัดนี้ = qtyInMachine × unitCostCents (สตางค์) */
  lineCostCents: number;
};

/** ตู้ 1 ตู้ = 1 การ์ด */
export type GalleryMachine = {
  id: string;
  code: string;
  nickname: string | null;
  kind: "CLAW" | "EXCHANGER";
  /** รูปการ์ด (resolved: หลังเติมก่อน → รูปตู้ → null) · absolute R2 url */
  photoUrl: string | null;
  /** ราคาเล่น (เหรียญ/ครั้ง) — null ถ้ายังไม่ตั้ง loadout */
  playPriceCoins: number | null;
  /** ราคาเล่น (บาท/ครั้ง) = coins × 10 — null ถ้ายังไม่ตั้ง */
  playPriceBaht: number | null;
  skus: GallerySku[];
  /** รวมทุนในตู้ (สตางค์) = Σ lineCostCents */
  totalCostCents: number;
  /** จำนวน SKU (ชนิดสินค้า) ที่มีของในตู้ */
  skuCount: number;
  /** จำนวนตัวรวมในตู้ = Σ qtyInMachine */
  totalUnits: number;
};

/** ตู้ทั้งหมดใน 1 สาขา */
export type GalleryBranch = {
  id: string;
  name: string;
  code: string;
  machines: GalleryMachine[];
};

export type MachineGalleryResult = {
  /** ตัวเลือกสาขา (ทุกสาขาตู้คีบในสโคป) — สำหรับ dropdown */
  branchOptions: GalleryBranchOption[];
  /** สาขาที่กำลังแสดง (null = ไม่มีสาขาให้แสดง) */
  branch: GalleryBranch | null;
};

/**
 * แกลเลอรีตู้ของ "หนึ่งสาขา" + รายชื่อสาขาทั้งหมดใน dropdown.
 *
 * @param branchId  สาขาที่ต้องการดู · undefined → เลือกสาขาแรกในสโคปให้อัตโนมัติ
 * @returns branchOptions (ทุกสาขา) + branch (สาขาที่แสดง · null ถ้าไม่มีตู้/ไม่มีสาขา)
 *
 * อ่านอย่างเดียว · scope orgId + userBranchIds · กันหลุดสาขานอกสิทธิ์ (ถ้า branchId
 * ที่ขอไม่อยู่ในสโคป → ตกไปใช้สาขาแรกในสโคปแทน · ไม่ throw).
 */
export async function getMachineGallery(
  branchId?: string,
): Promise<MachineGalleryResult> {
  const session = await requireCfSession();
  const orgId = session.user.org_id;
  const allowed = await userBranchIds(session);

  // ── สาขาตู้คีบทั้งหมดในสโคป (dropdown) ──
  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(allowed === "ALL" ? {} : { id: { in: allowed } }),
    },
    orderBy: [{ code: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true },
  });

  if (branches.length === 0) {
    return { branchOptions: [], branch: null };
  }

  // นับตู้ active ต่อสาขา (groupBy แยก — ไม่พึ่ง filtered _count เพื่อความชัวร์)
  const machineCounts = await prisma.cfMachine.groupBy({
    by: ["branchId"],
    where: {
      orgId,
      isActive: true,
      branchId: { in: branches.map((b) => b.id) },
    },
    _count: { _all: true },
  });
  const countByBranch = new Map(machineCounts.map((c) => [c.branchId, c._count._all]));

  const branchOptions: GalleryBranchOption[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    machineCount: countByBranch.get(b.id) ?? 0,
  }));

  // เลือกสาขาที่จะแสดง: ตาม branchId ที่ขอ (ถ้าอยู่ในสโคป) · ไม่งั้นสาขาแรก
  const chosen =
    (branchId && branchOptions.find((b) => b.id === branchId)) ||
    branchOptions[0];

  const branch = await loadBranchGallery(orgId, chosen.id, chosen.name, chosen.code);
  return { branchOptions, branch };
}

/**
 * โหลดตู้ทุกตู้ในสาขา + รูป + ราคาเล่น + SKU/จำนวน/ทุน.
 * แยกเป็น helper เพื่ออ่านง่าย · เรียกด้วย branch ที่ผ่านการ scope มาแล้ว.
 */
async function loadBranchGallery(
  orgId: string,
  branchId: string,
  branchName: string,
  branchCode: string,
): Promise<GalleryBranch> {
  // ── ตู้ทั้งหมดในสาขา (active) ──
  const machines = await prisma.cfMachine.findMany({
    where: { orgId, branchId, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, nickname: true, kind: true, photoUrl: true },
  });

  if (machines.length === 0) {
    return { id: branchId, name: branchName, code: branchCode, machines: [] };
  }

  const machineIds = machines.map((m) => m.id);

  // ── รูปสต็อกหลังเติมล่าสุดต่อตู้ (photoStockUrl · ยังไม่ purge) ──
  //   ดึง event ที่มีรูป เรียงใหม่→เก่า แล้วเก็บ "อันแรกที่เจอ" ต่อ machineId = ล่าสุด.
  const stockPhotoEvents = await prisma.cfCollectionEvent.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      photoStockUrl: { not: null },
      photosPurgedAt: null,
    },
    orderBy: { collectedAt: "desc" },
    select: { machineId: true, photoStockUrl: true },
  });
  const afterRefillPhoto = new Map<string, string>();
  for (const e of stockPhotoEvents) {
    if (e.photoStockUrl && !afterRefillPhoto.has(e.machineId)) {
      afterRefillPhoto.set(e.machineId, e.photoStockUrl);
    }
  }

  // ── loadout ปัจจุบันต่อตู้ (ราคาเล่น) — effectiveTo IS NULL ──
  //   1 ตู้อาจมีหลายบรรทัด (หลาย product) แต่ราคาเล่นปกติเท่ากันทั้งตู้ →
  //   ใช้ราคาแรกที่เจอต่อ machineId (ใหม่สุดก่อน) เป็นราคาเล่นของตู้.
  const loadouts = await prisma.cfMachineLoadout.findMany({
    where: { orgId, machineId: { in: machineIds }, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
    select: { machineId: true, pricePerPlayCoins: true },
  });
  const playPriceByMachine = new Map<string, number>();
  for (const l of loadouts) {
    if (!playPriceByMachine.has(l.machineId)) {
      playPriceByMachine.set(l.machineId, l.pricePerPlayCoins);
    }
  }

  // ── จำนวนในตู้ต่อ (machineId, productId): Σ qty ใน cf_stock_movements ──
  //   machineId != null → LOAD_TO_MACHINE เป็นลบ → |Σ| = จำนวนคงในตู้ (mirror stock-queries).
  const moves = await prisma.cfStockMovement.groupBy({
    by: ["machineId", "productId"],
    where: { orgId, branchId, machineId: { in: machineIds } },
    _sum: { qty: true },
  });

  // เก็บ productId ที่โผล่ (เพื่อ join ทุน/ชื่อ/รูปทีเดียว)
  const productIds = Array.from(new Set(moves.map((m) => m.productId)));
  const products =
    productIds.length === 0
      ? []
      : await prisma.cfProduct.findMany({
          where: { orgId, id: { in: productIds } },
          select: { id: true, sku: true, name: true, imageUrl: true, unitCostCents: true },
        });
  const productById = new Map(products.map((p) => [p.id, p]));

  // machineId → รายการ SKU (มีของจริงเท่านั้น · qty != 0)
  const skusByMachine = new Map<string, GallerySku[]>();
  for (const mv of moves) {
    if (mv.machineId == null) continue; // groupBy คืน key ตาม where แล้ว แต่กัน type null
    const qty = Math.abs(mv._sum.qty ?? 0);
    if (qty === 0) continue; // เคยมีแต่ตอนนี้ 0 → ไม่โชว์
    const p = productById.get(mv.productId);
    if (!p) continue;
    const lineCostCents = qty * p.unitCostCents;
    const list = skusByMachine.get(mv.machineId) ?? [];
    list.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      imageUrl: p.imageUrl,
      qtyInMachine: qty,
      unitCostCents: p.unitCostCents,
      lineCostCents,
    });
    skusByMachine.set(mv.machineId, list);
  }
  // เรียง SKU ในแต่ละตู้: ทุนรวมมากก่อน (ของแพงอยู่บน) แล้วชื่อ
  for (const list of skusByMachine.values()) {
    list.sort((a, b) => b.lineCostCents - a.lineCostCents || a.name.localeCompare(b.name, "th"));
  }

  const galleryMachines: GalleryMachine[] = machines.map((m) => {
    const skus = skusByMachine.get(m.id) ?? [];
    const totalCostCents = skus.reduce((s, x) => s + x.lineCostCents, 0);
    const totalUnits = skus.reduce((s, x) => s + x.qtyInMachine, 0);
    const playPriceCoins = playPriceByMachine.get(m.id) ?? null;
    return {
      id: m.id,
      code: m.code,
      nickname: m.nickname,
      kind: m.kind === "EXCHANGER" ? "EXCHANGER" : "CLAW",
      // รูปการ์ด: หลังเติมก่อน → รูปตู้เอง → null
      photoUrl: afterRefillPhoto.get(m.id) ?? m.photoUrl ?? null,
      playPriceCoins,
      playPriceBaht: playPriceCoins == null ? null : playPriceCoins * COIN_BAHT,
      skus,
      totalCostCents,
      skuCount: skus.length,
      totalUnits,
    };
  });

  return { id: branchId, name: branchName, code: branchCode, machines: galleryMachines };
}
