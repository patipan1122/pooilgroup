"use server";

// DC Warehouse · TRANSFER (ส่ง/โอน) — 2-step in-transit + 1-tap confirm.
//
// WORKSHOP-LOCKED behavior (do NOT change without re-running the workshop):
//   • โอนเป็น 2 จังหวะ — ไม่ "รับเข้า" คลังปลายทางเงียบ ๆ อัตโนมัติ:
//       1) DISPATCH ที่ต้นทาง  → ต้นทาง qtyOnHand −n, qtyInTransit +n · สถานะ IN_TRANSIT
//       2) CONFIRM ที่ปลายทาง (กดเดียว) → ปลายทาง qtyOnHand +n, ต้นทาง qtyInTransit −n · สถานะ CONFIRMED
//     ต้นทุน "ตามของไป" — carry unitCostSatang/costLayerId ของต้นทางมาที่ใบรับปลายทาง
//     (การโอนไม่ใช่การตีราคาใหม่ revaluation).
//   • sameSite=true (ย้ายในไซต์เดียวกัน ปลายทางเป็น DC warehouse ที่เราคุมเอง) → รับเข้าทันที (auto-confirm)
//   • ปลายทาง = MODULE/สาขา (destType=MODULE) → บันทึก dispatch (TRANSFER_OUT) อย่างเดียว แล้วกด
//     "ยืนยันส่งถึง" (1 tap) ปิดใบเป็น CONFIRMED.
//       - ถ้าปลายทางเป็น "สาขาตู้คีบ" (ClawFleet · toBranchId + businessType=claw_machine) → Wave 6:
//         เขียนสต๊อกเข้า "สโตร์สาขา" (คลังหลัก) ของสาขานั้นจริง (receiveDcTransferIntoBranchTx) +
//         อัปเดตต้นทุนเฉลี่ยถ่วงน้ำหนัก. ต้นทุน carry 1:1 (satang == cents · ไม่สเกล).
//         ★ SHARED TX (Fix 1): status-claim + in-transit decrement + CF-receive อยู่ tx เดียว (all-or-nothing ·
//         ข้าม schema dc↔public ได้ · ไม่มี stock-loss/double-decrement).
//       - ปลายทาง MODULE อื่น (label อิสระ) → ยังปิดใบเฉย ๆ (ไม่เขียนเข้าโมดูลอื่น) เหมือนเดิม.
//   • autoPromoteStaleTransfers — ใบ IN_TRANSIT ที่ค้างเกิน N ชม. → WAREHOUSE: รับเข้าอัตโนมัติ + mark
//     AUTO_UNVERIFIED (ติดธง ไม่หายเงียบ ๆ) · MODULE: mark AUTO_UNVERIFIED + ปิด in-transit. (reconcile job เรียก)
//
// ★ IDEMPOTENCY: client uuid ต่อใบ + ต่อบรรทัด → sourceKey("tfo",transferId,lineKey) ตอนส่งออก /
//   sourceKey("tfi",transferId,lineId) ตอนรับเข้า → @@unique([orgId,sourceKey]) ทำให้กดซ้ำ/รีทราย = no-op.

import { requireSession } from "@/lib/auth/session";
import { canDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { sourceKey, transferCode } from "@/lib/dc/codes";
import { prisma } from "@/lib/prisma";
import { DcMoveKind, DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";
import { recordMovement, findProductByCode, getOnHand } from "@/lib/dc/stock";
import { getPoFulfillment } from "@/lib/dc/po-fulfillment";
import { resolveClawfleetProduct, isClawfleetBranch, assertClawfleetBranchInOrg } from "@/lib/dc/product-link";
import { receiveDcTransferIntoBranchTx } from "@/lib/clawfleet/stock-actions";

// ════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════

/**
 * อ่าน "ต้นทุนล่าสุด" ของสินค้าในคลังต้นทาง — เอามาแปะตามของไปปลายทาง.
 * ดูจาก movement ที่นำของ "เข้า" ล่าสุด (RECEIVE/TRANSFER_IN) ที่มี unitCostSatang.
 * คืน null ทั้งคู่ถ้าไม่เคยมีต้นทุน (เช่นของที่ไม่เคยผ่านการรับเข้าแบบมีต้นทุน).
 */
async function latestCostAtSource(
  orgId: string,
  warehouseId: string,
  productId: string,
): Promise<{ unitCostSatang: number | null; costLayerId: string | null }> {
  const mv = await prisma.dcStockMovement.findFirst({
    where: {
      orgId,
      warehouseId,
      productId,
      kind: { in: [DcMoveKind.RECEIVE, DcMoveKind.TRANSFER_IN] },
      unitCostSatang: { not: null },
    },
    orderBy: { occurredAt: "desc" },
    select: { unitCostSatang: true, costLayerId: true },
  });
  return { unitCostSatang: mv?.unitCostSatang ?? null, costLayerId: mv?.costLayerId ?? null };
}

// ════════════════════════════════════════════════════════════════════
// lookup (สแกน/พิมพ์รหัสหน้าส่งออก)
// ════════════════════════════════════════════════════════════════════

export type LookupForTransferResult =
  | {
      ok: true;
      product: {
        id: string;
        name: string;
        sku: string;
        unit: string;
        onHand: number;
      };
    }
  | { ok: false; error: string };

/** ค้นหาสินค้าจากบาร์โค้ด/SKU + อ่านยอดคงเหลือที่คลังต้นทาง. scope ด้วย orgId. */
export async function lookupForTransfer(args: {
  fromWarehouseId: string;
  code: string;
}): Promise<LookupForTransferResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const code = (args.code ?? "").trim();
  if (!code) return { ok: false, error: "กรุณากรอกรหัส" };

  const from = (args.fromWarehouseId ?? "").trim();
  if (!from) return { ok: false, error: "ยังไม่ได้เลือกคลังต้นทาง" };

  try {
    await assertWarehouseAllowed(session, from);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  const product = await findProductByCode(orgId, code);
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  const onHand = await getOnHand(from, product.id);

  return {
    ok: true,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit ?? "ชิ้น",
      onHand,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// listStockForPick (เลือกจากรายการ — ตอนกดเลือกแทนการสแกน)
// ════════════════════════════════════════════════════════════════════

export type PickRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  imageUrl: string | null; // URL รูปสินค้าเต็ม (null = ไม่มีรูป)
};

export type ListStockForPickResult =
  | { ok: true; rows: PickRow[] }
  | { ok: false; error: string };

/**
 * รายการสินค้าที่ "มีของอยู่จริง" ในคลังต้นทาง (qtyOnHand > 0) ให้ผู้ใช้กดเลือกแทนการสแกน.
 *  - scope: orgId + warehouse · เฉพาะ balance ที่ qtyOnHand > 0
 *  - q (ไม่บังคับ): กรองตามชื่อ/SKU (case-insensitive)
 *  - เรียงตามชื่อ · จำกัด ~100 แถว (กันลิสต์ยาวเกินบนมือถือ)
 */
export async function listStockForPick(args: {
  fromWarehouseId: string;
  q?: string;
}): Promise<ListStockForPickResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const from = (args.fromWarehouseId ?? "").trim();
  if (!from) return { ok: false, error: "ยังไม่ได้เลือกคลังต้นทาง" };

  try {
    await assertWarehouseAllowed(session, from);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  const q = (args.q ?? "").trim();

  const balances = await prisma.dcStockBalance.findMany({
    where: {
      orgId,
      warehouseId: from,
      qtyOnHand: { gt: 0 },
      product: {
        active: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    },
    select: {
      qtyOnHand: true,
      product: { select: { id: true, sku: true, name: true, unit: true, imageR2Path: true } },
    },
    orderBy: { product: { name: "asc" } },
    take: 100,
  });

  // resolve รูปสินค้าเป็น URL เต็ม (R2 key หรือ http เต็ม)
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

  const rows: PickRow[] = balances.map((b) => ({
    productId: b.product.id,
    sku: b.product.sku,
    name: b.product.name,
    unit: b.product.unit ?? "ชิ้น",
    onHand: b.qtyOnHand,
    imageUrl: toImageUrl(b.product.imageR2Path),
  }));

  return { ok: true, rows };
}

// ════════════════════════════════════════════════════════════════════
// dispatch (ส่งออกจากต้นทาง → สร้างใบโอน)
// ════════════════════════════════════════════════════════════════════

export type DispatchLine = {
  productId: string;
  qty: number;
  /** uuid ต่อบรรทัด (client สร้างตอนเพิ่ม) — idempotency key */
  lineKey: string;
  /** Pinpoint #2 — บรรทัดนี้โอนจากใบ PO ไหน (โอนจากหลายใบพร้อมกัน) · ถ้าไม่มี → ใช้ header poId */
  poId?: string;
};

export type DispatchTransferInput = {
  fromWarehouseId: string;
  destType: DcTransferDestType;
  /** ปลายทางเป็น DC warehouse (destType=WAREHOUSE) */
  toWarehouseId?: string;
  /** ปลายทางเป็นโมดูล (destType=MODULE) — ชื่อโมดูล เช่น "playland" */
  toModule?: string;
  toBranchId?: string;
  /** ป้ายปลายทางที่พิมพ์เอง (MODULE/สาขา) */
  toLabel?: string;
  /** ย้ายในไซต์เดียวกัน → รับเข้าทันที (เฉพาะ WAREHOUSE) */
  sameSite?: boolean;
  note?: string;
  /** โอน "อ้างใบ PO" ใบนี้ (documentary) — กันไม่ให้โอนเกิน "เหลือในใบ" */
  poId?: string;
  /** ค่าขนส่งไทย-ไทยของใบโอนนี้ (satang) — บันทึกเป็นค่าใช้จ่าย (ไม่บวกเข้าต้นทุนสินค้า) */
  thaiFreightSatang?: number;
  thaiFreightNote?: string;
  lines: DispatchLine[];
};

export type DispatchTransferResult =
  | { ok: true; transferId: string; status: DcTransferStatus }
  | { ok: false; error: string };

/**
 * ส่งออก (จังหวะที่ 1): หักของจากต้นทาง + ดันเข้า in-transit + สร้างใบโอน.
 *  - ต้นทุนของแต่ละบรรทัด อ่านจาก movement ล่าสุดที่ต้นทาง แล้ว carry ลงใบ + movement TRANSFER_OUT
 *  - sameSite + ปลายทาง warehouse → รับเข้าทันที (auto-confirm) ในการเรียกเดียว
 *  - บรรทัดที่สต๊อกไม่พอ → คืน error (ทั้งใบ rollback แบบ best-effort: เราตรวจ onHand ก่อน)
 */
export async function dispatchTransfer(input: DispatchTransferInput): Promise<DispatchTransferResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const from = (input.fromWarehouseId ?? "").trim();
  if (!from) return { ok: false, error: "ยังไม่ได้เลือกคลังต้นทาง" };

  try {
    await assertWarehouseAllowed(session, from);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  const destType = input.destType;
  const toWarehouseId = (input.toWarehouseId ?? "").trim() || null;
  const toModule = (input.toModule ?? "").trim() || null;
  const toBranchId = (input.toBranchId ?? "").trim() || null;
  const toLabel = (input.toLabel ?? "").trim() || null;
  const sameSite = destType === DcTransferDestType.WAREHOUSE && !!input.sameSite && !!toWarehouseId;

  // ตรวจปลายทางสมเหตุสมผล
  if (destType === DcTransferDestType.WAREHOUSE) {
    if (!toWarehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลังปลายทาง" };
    if (toWarehouseId === from) return { ok: false, error: "คลังต้นทางและปลายทางต้องไม่ใช่คลังเดียวกัน" };
    try {
      await assertWarehouseAllowed(session, toWarehouseId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังปลายทาง" };
    }
  } else {
    // MODULE: ต้องมีป้ายปลายทาง (label) หรือ module/branch อย่างน้อยหนึ่ง
    if (!toLabel && !toModule && !toBranchId) {
      return { ok: false, error: "ยังไม่ได้ระบุปลายทาง (สาขา/โมดูล)" };
    }
    // ★ FIX 5 / Fix 2 (dispatch-side · server-side scope · กัน crafted toBranchId ข้าม org):
    //   - toModule='clawfleet' → ต้องมี toBranchId ที่เป็น "สาขาตู้คีบของ org ผู้เรียกจริง"
    //     (orgId ตรง + claw_machine + active) — picker หน้าจอ scope แค่ UI.
    //   - มี toBranchId (โมดูลอื่น) → อย่างน้อยต้องเป็นสาขาใน org ผู้เรียก (กันชี้ข้าม org).
    if (toModule === "clawfleet") {
      if (!toBranchId) return { ok: false, error: "ยังไม่ได้เลือกสาขาปลายทาง (ตู้คีบ)" };
      const chk = await assertClawfleetBranchInOrg(orgId, toBranchId);
      if (!chk.ok) return { ok: false, error: chk.error };
    } else if (toBranchId) {
      const b = await prisma.branch.findFirst({ where: { id: toBranchId, orgId }, select: { id: true } });
      if (!b) return { ok: false, error: "ไม่พบสาขาปลายทางในองค์กรนี้" };
    }
  }

  // กรอง + ดีดูปบรรทัด (qty>0, มี productId+lineKey, lineKey ไม่ซ้ำในใบ)
  const seen = new Set<string>();
  const lines = (input.lines ?? [])
    .filter((l) => l.productId && l.lineKey && Number.isFinite(l.qty) && l.qty > 0)
    .filter((l) => {
      if (seen.has(l.lineKey)) return false;
      seen.add(l.lineKey);
      return true;
    })
    .map((l) => ({ productId: l.productId, qty: Math.trunc(l.qty), lineKey: l.lineKey, poId: (l.poId ?? "").trim() || null }));

  if (lines.length === 0) return { ok: false, error: "ยังไม่มีรายการส่งออก" };

  // ตรวจสต๊อกพอทุกบรรทัดก่อน (กันใบครึ่ง ๆ กลาง ๆ — ของหักไปบางบรรทัดแล้ว fail บรรทัดหลัง)
  for (const l of lines) {
    const onHand = await getOnHand(from, l.productId);
    if (l.qty > onHand) {
      return { ok: false, error: `สต๊อกไม่พอสำหรับบางรายการ (มี ${onHand} ต้องการ ${l.qty})` };
    }
  }

  // โอน "อ้างใบ PO" → กันไม่ให้โอนเกิน "เหลือในใบ PO" (documentary ledger ไม่ให้ติดลบ).
  // หมายเหตุ: นี่เป็นการกันเชิงเอกสาร · การตัดสต๊อกจริงตัดจาก onHand ด้านบนเสมอ.
  //   Pinpoint #2 · โอนจากหลายใบพร้อมกัน → poId ต่อบรรทัด (fallback = header input.poId) · cap แยกต่อใบ
  const headerPoId = (input.poId ?? "").trim() || null;
  const effPoOf = (l: { poId: string | null }): string | null => l.poId || headerPoId;
  const linesByPo = new Map<string, typeof lines>();
  for (const l of lines) {
    const lp = effPoOf(l);
    if (!lp) continue;
    if (!linesByPo.has(lp)) linesByPo.set(lp, []);
    linesByPo.get(lp)!.push(l);
  }
  for (const [lp, plines] of linesByPo) {
    const ful = await getPoFulfillment(orgId, lp, { warehouseId: from });
    if (!ful) return { ok: false, error: "ไม่พบใบ PO ที่อ้างอิง" };
    const remainByProduct = new Map(ful.lines.map((l) => [l.productId, l.remaining]));
    const wantByProduct = new Map<string, number>();
    for (const l of plines) {
      wantByProduct.set(l.productId, (wantByProduct.get(l.productId) ?? 0) + l.qty);
    }
    for (const [pid, want] of wantByProduct) {
      const remain = remainByProduct.get(pid) ?? 0;
      if (want > remain) {
        const nm = ful.lines.find((l) => l.productId === pid)?.name ?? "สินค้า";
        return {
          ok: false,
          error: `โอนเกินยอดที่เหลือในใบ PO ${ful.poCode} — "${nm}" เหลือให้โอน/เบิก ${remain} แต่จะโอน ${want}`,
        };
      }
    }
  }
  // header poId = ใบหลัก (input.poId หรือใบแรกที่บรรทัดอ้าง) · การนับ movedOut ใช้ movement.po_id ต่อบรรทัด
  const poId = headerPoId ?? (lines.map(effPoOf).find((p): p is string => !!p) ?? null);

  // ค่าขนส่งไทย-ไทย (บันทึกบนหัวใบ · ไม่แตะต้นทุนสินค้า/cost layer)
  const thaiFreightSatang = Math.max(0, Math.trunc(Number(input.thaiFreightSatang) || 0));
  const thaiFreightNote = (input.thaiFreightNote ?? "").trim() || null;

  // อ่านต้นทุนล่าสุดต่อบรรทัด (carry ตามของไป)
  const enriched = await Promise.all(
    lines.map(async (l) => {
      const cost = await latestCostAtSource(orgId, from, l.productId);
      return { ...l, unitCostSatang: cost.unitCostSatang, costLayerId: cost.costLayerId };
    }),
  );

  // สร้างใบโอน + บรรทัด (สถานะตาม sameSite)
  const tCode = transferCode();
  let transfer: { id: string };
  try {
    transfer = await prisma.dcTransfer.create({
      data: {
        orgId,
        transferCode: tCode,
        fromWarehouseId: from,
        destType,
        toWarehouseId: destType === DcTransferDestType.WAREHOUSE ? toWarehouseId : null,
        toModule: destType === DcTransferDestType.MODULE ? toModule : null,
        toBranchId: destType === DcTransferDestType.MODULE ? toBranchId : null,
        toLabel,
        status: sameSite ? DcTransferStatus.CONFIRMED : DcTransferStatus.IN_TRANSIT,
        sameSite,
        dispatchedByUserId: userId,
        ...(sameSite ? { confirmedByUserId: userId, confirmedAt: new Date() } : {}),
        note: (input.note ?? "").trim() || null,
        poId,
        thaiFreightSatang,
        thaiFreightNote,
        lines: {
          create: enriched.map((l) => ({
            orgId,
            productId: l.productId,
            qty: l.qty,
            unitCostSatang: l.unitCostSatang,
            costLayerId: l.costLayerId,
            poId: l.poId ?? headerPoId, // Pinpoint #2 — บรรทัดนี้มาจากใบ PO ไหน (ใช้ตอน cancel คืน po_id)
            // sameSite รับเข้าทันที → qtyReceived = qty (ครบ)
            ...(sameSite ? { qtyReceived: l.qty } : {}),
          })),
        },
      },
      select: { id: true },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างใบโอนไม่สำเร็จ" };
  }

  const transferId = transfer.id;

  // จังหวะที่ 1: TRANSFER_OUT ที่ต้นทาง (qty −n, inTransitDelta +n) — idempotent ต่อบรรทัด
  for (const l of enriched) {
    const res = await recordMovement({
      orgId,
      warehouseId: from,
      productId: l.productId,
      kind: DcMoveKind.TRANSFER_OUT,
      qty: -Math.abs(l.qty),
      inTransitDelta: Math.abs(l.qty),
      poId: l.poId ?? headerPoId, // Pinpoint #2 — ผูก TRANSFER_OUT กับใบ PO ของบรรทัดนี้ (นับ movedOut ต่อใบ)
      unitCostSatang: l.unitCostSatang,
      costLayerId: l.costLayerId,
      sourceKey: sourceKey("tfo", transferId, l.lineKey),
      refType: "dc_transfer",
      refId: transferId,
      note: `ส่งออก ${tCode}`,
      actorUserId: userId,
    });
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
  }

  // sameSite → รับเข้าปลายทางทันที (auto-confirm)
  if (sameSite && toWarehouseId) {
    for (const l of enriched) {
      // TRANSFER_IN ที่ปลายทาง (carry ต้นทุน)
      const inRes = await recordMovement({
        orgId,
        warehouseId: toWarehouseId,
        productId: l.productId,
        kind: DcMoveKind.TRANSFER_IN,
        qty: Math.abs(l.qty),
        unitCostSatang: l.unitCostSatang,
        costLayerId: l.costLayerId,
        sourceKey: sourceKey("tfi", transferId, l.lineKey),
        refType: "dc_transfer",
        refId: transferId,
        note: `รับโอน ${tCode} (อยู่ที่เดียวกัน)`,
        actorUserId: userId,
      });
      if (!inRes.ok) return { ok: false, error: inRes.error };

      // ลด in-transit ของต้นทาง
      await decrementSourceInTransit(from, l.productId, Math.abs(l.qty));
    }
  }

  return { ok: true, transferId, status: sameSite ? DcTransferStatus.CONFIRMED : DcTransferStatus.IN_TRANSIT };
}

/**
 * ลด qtyInTransit ของ balance ต้นทางลง n (floor ที่ 0 กัน negative).
 * ใช้ atomic `{ decrement: n }` (ไม่ใช่ read-modify-write) → กันสอง request ลดทับกัน
 * แล้วเหลือผลแค่ครั้งเดียว (lost update). เนื่องจากตัวเรียก (confirmTransfer ผู้ชนะ /
 * cron ผู้ชนะ) ถูก gate ด้วย atomic status-reserve อยู่แล้ว ตัวนี้จึงรันต่อใบครั้งเดียว;
 * atomic decrement เป็นชั้นกันซ้ำชั้นที่สอง. ถ้าลดแล้วติดลบ → clamp กลับเป็น 0.
 */
async function decrementSourceInTransit(warehouseId: string, productId: string, n: number): Promise<void> {
  if (n <= 0) return;
  try {
    const updated = await prisma.dcStockBalance.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: { qtyInTransit: { decrement: n } },
      select: { qtyInTransit: true },
    });
    // clamp กัน negative (ถ้าฐานเดิมน้อยกว่า n ด้วยเหตุผิดปกติ)
    if ((updated.qtyInTransit ?? 0) < 0) {
      await prisma.dcStockBalance.update({
        where: { warehouseId_productId: { warehouseId, productId } },
        data: { qtyInTransit: 0 },
      });
    }
  } catch {
    // ไม่มี balance row (P2025) → no-op เงียบ ๆ (เหมือนพฤติกรรมเดิมที่ return เมื่อ !bal)
  }
}

/** tx-aware variant ของ decrementSourceInTransit — ทำงานบน tx ที่ caller ส่งเข้ามา (SHARED TX · Fix 1).
 *  math เดียวกัน: atomic { decrement } + clamp กัน negative. ไม่ throw ถ้าไม่มี balance row (P2025 → no-op). */
async function decrementSourceInTransitTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  warehouseId: string,
  productId: string,
  n: number,
): Promise<void> {
  if (n <= 0) return;
  try {
    const updated = await tx.dcStockBalance.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: { qtyInTransit: { decrement: n } },
      select: { qtyInTransit: true },
    });
    if ((updated.qtyInTransit ?? 0) < 0) {
      await tx.dcStockBalance.update({
        where: { warehouseId_productId: { warehouseId, productId } },
        data: { qtyInTransit: 0 },
      });
    }
  } catch (e) {
    // ไม่มี balance row (P2025) → no-op · error อื่น = rethrow
    //   (อยู่ใน SHARED TX: ถ้ากลืน error จริง = tx commit ทั้งที่ตัด in-transit ไม่สำเร็จ = in-transit ค้างเกิน)
    if ((e as { code?: string } | null)?.code !== "P2025") throw e;
  }
}

// ════════════════════════════════════════════════════════════════════
// confirm (ปลายทางรับ — 1 tap หรือ รายบรรทัดถ้าไม่ครบ)
// ════════════════════════════════════════════════════════════════════

export type ConfirmTransferInput = {
  transferId: string;
  /** ถ้าไม่ส่ง → รับครบทุกบรรทัดตามที่ส่งออก (1-tap "ครบ") */
  lines?: { lineId: string; qtyReceived: number }[];
};

export type ConfirmTransferResult = { ok: true } | { ok: false; error: string };

/**
 * ยืนยันปลายทางรับ (จังหวะที่ 2). idempotent — ถ้าใบ CONFIRMED/AUTO_UNVERIFIED แล้ว คืน ok เลย.
 *  - WAREHOUSE dest → ทุกบรรทัด: TRANSFER_IN ที่ปลายทาง (carry ต้นทุน) + ลด in-transit ต้นทาง
 *  - MODULE dest → ปิดใบเฉย ๆ (ลด in-transit ต้นทาง · ไม่เขียนเข้าตารางโมดูลอื่น — PHASE 3)
 *  - ตั้งสถานะ CONFIRMED + confirmedBy/At · บันทึก qtyReceived รายบรรทัด
 */
export async function confirmTransfer(input: ConfirmTransferInput): Promise<ConfirmTransferResult> {
  const session = await requireSession();
  // พนักงานหน้างาน (floor) กด "รับของเข้า" ได้ — แต่ล็อกตามคลังที่ผูกสิทธิ์ (ตรวจ toWarehouseId
  // หลังโหลดใบด้านล่าง). widen จาก manager-only → floor + hard per-warehouse binding.
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ยืนยันรับโอน" };
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const transferId = (input.transferId ?? "").trim();
  if (!transferId) return { ok: false, error: "ไม่พบใบโอน" };

  const transfer = await prisma.dcTransfer.findFirst({
    where: { id: transferId, orgId },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      destType: true,
      toWarehouseId: true,
      // Wave 6 — ปลายทางโมดูล/สาขา (ClawFleet): toModule/toBranchId ระบุว่าเป็นสาขาตู้คีบ
      toModule: true,
      toBranchId: true,
      toLabel: true,
      status: true,
      lines: {
        select: { id: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true },
      },
    },
  });
  if (!transfer) return { ok: false, error: "ไม่พบใบโอน" };

  // ── AUTHORIZATION (per-warehouse binding) ──────────────────────────────
  // WAREHOUSE dest → floor รับได้ แต่ต้องผูกสิทธิ์คลังปลายทาง (assertWarehouseAllowed)
  //   → กันพนักงานยืนยันรับเข้า "คลังที่ไม่ได้รับมอบหมาย".
  // MODULE dest → ปิดใบเข้าสาขา/โมดูล = งานหลังบ้าน → ยังคง manager-only เหมือนเดิม.
  if (transfer.destType === DcTransferDestType.WAREHOUSE) {
    if (!transfer.toWarehouseId) return { ok: false, error: "ใบโอนนี้ไม่มีคลังปลายทาง" };
    try {
      await assertWarehouseAllowed(session, transfer.toWarehouseId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์รับเข้าคลังนี้" };
    }
  } else {
    // MODULE dest — 2 ทางที่ยืนยันได้ (อย่างใดอย่างหนึ่ง):
    //   (A) ผู้จัดการหลังบ้าน (canDcManage) — พาธเดิม ทุก MODULE dest.
    //   (B) พนักงานที่ "สังกัดสาขาปลายทางนั้นจริง" (userBranch: userId+toBranchId) — เฉพาะปลายทาง
    //       ที่เป็น "สาขาตู้คีบ" (ClawFleet · MODULE + toBranchId) เพื่อให้พนักงานหน้าสาขา
    //       กดรับของเข้าสโตร์สาขาตัวเองได้จากแอปมือถือ.
    //   ★ SERVER-SIDE branch-scope (ไม่ใช่แค่ซ่อนปุ่มใน UI): ต้องมีแถว userBranch ผูก user กับ
    //     toBranchId ของ "ใบนี้" เท่านั้น → พนักงานสาขา A ยืนยันใบที่ปลายทางสาขา B ไม่ได้เด็ดขาด.
    //     (mirror รูปแบบเดียวกับ ClawFleet role-guard assertCanAccessBranch: prisma.userBranch.findFirst)
    if (!canDcManage(session.user.role)) {
      const branchId = transfer.toBranchId;
      let allowedByBranch = false;
      if (branchId) {
        // ปลายทางต้องเป็น "สาขาตู้คีบของ org ผู้เรียก" จริง (orgId ตรง + claw_machine + active) —
        // กัน MODULE label อิสระ/สาขาประเภทอื่นถูกเปิดสิทธิ์รับผ่าน branch-membership.
        const chk = await assertClawfleetBranchInOrg(orgId, branchId);
        if (chk.ok) {
          const ub = await prisma.userBranch.findFirst({
            where: { userId, branchId },
            select: { id: true },
          });
          allowedByBranch = !!ub;
        }
      }
      if (!allowedByBranch) {
        return { ok: false, error: "ไม่มีสิทธิ์ยืนยันส่งถึงสาขา/โมดูล (ต้องเป็นหลังบ้านหรือพนักงานสาขาปลายทาง)" };
      }
    }
  }

  // idempotent — ปิดไปแล้วก็ถือว่าสำเร็จ
  if (transfer.status === DcTransferStatus.CONFIRMED || transfer.status === DcTransferStatus.AUTO_UNVERIFIED) {
    return { ok: true };
  }
  if (transfer.status === DcTransferStatus.CANCELLED) {
    return { ok: false, error: "ใบนี้ถูกยกเลิกแล้ว" };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Wave 6 · ปลายทาง = สาขาตู้คีบ (ClawFleet) → เขียนสต๊อกเข้า "สโตร์สาขา" จริง
  // ══════════════════════════════════════════════════════════════════════
  // ตรวจว่าใบนี้ปลายทางเป็นสาขาตู้คีบไหม: MODULE + มี toBranchId + (toModule=clawfleet หรือสาขานั้น
  // businessType=claw_machine). ถ้าใช่ → resolve mapping DcProduct↔CfProduct "ก่อน" status-claim.
  //
  // ★ ATOMICITY (chosen: SHARED TX · Fix 1) — status-claim + qtyReceived + source in-transit decrement +
  //   CF-receive ทำใน prisma.$transaction เดียว (ดูบล็อก "FIX 1 — SHARED TX" ด้านล่าง). no-silent-loss:
  //     1) resolve ทุก mapping "นอก tx" ก่อน (อาจ auto-create CfProduct · idempotent) → พัง = คืน error โดยยัง
  //        ไม่แตะสถานะ/in-transit/CF เลย (ไม่มีอะไรค้าง)
  //     2) เข้า tx เดียว: claim IN_TRANSIT→CONFIRMED → qtyReceived → ลด in-transit → receiveDcTransferIntoBranchTx
  //     3) ถ้าอะไรใน tx throw → rollback ทั้งก้อน (ใบยัง IN_TRANSIT · in-transit ครบ · CF ว่าง) → error retryable
  const isClawfleetDest =
    transfer.destType === DcTransferDestType.MODULE &&
    !!transfer.toBranchId &&
    (transfer.toModule === "clawfleet" || (await isClawfleetBranch(orgId, transfer.toBranchId)));

  // ★ CROSS-ORG GUARD (Fix 2): ก่อนเขียนสต๊อกเข้า ClawFleet ยืนยันสาขาปลายทางเป็น
  //   "สาขาตู้คีบของ org ผู้เรียกจริง" (orgId ตรง + claw_machine + active). isClawfleetDest ยอม
  //   short-circuit ผ่าน toModule==='clawfleet' โดยไม่เช็ค org → ต้อง re-assert ตรงนี้ก่อน tx.
  if (isClawfleetDest && transfer.toBranchId) {
    const chk = await assertClawfleetBranchInOrg(orgId, transfer.toBranchId);
    if (!chk.ok) return { ok: false, error: chk.error };
  }

  // resolve mapping ทุกบรรทัด "ก่อน" reserve — พังตรงนี้ = ยังไม่แตะสถานะใบเลย (block confirm ปลอดภัย).
  let cfLinesByLineId: Map<string, { cfProductId: string; unitCostSatang: number }> | null = null;
  if (isClawfleetDest && transfer.toBranchId) {
    try {
      // ดึงข้อมูลสินค้า DC (sku/barcode/name/รูป) เพื่อ match/สร้าง CfProduct
      const dcProdIds = [...new Set(transfer.lines.map((l) => l.productId))];
      const dcProducts = await prisma.dcProduct.findMany({
        where: { id: { in: dcProdIds }, orgId },
        select: { id: true, sku: true, barcode: true, name: true, imageR2Path: true },
      });
      const r2Public = process.env.R2_PUBLIC_URL ?? "";
      const toImageUrl = (key: string | null): string | null =>
        !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;
      const dcById = new Map(dcProducts.map((p) => [p.id, p]));

      cfLinesByLineId = new Map();
      for (const line of transfer.lines) {
        const dp = dcById.get(line.productId);
        if (!dp) throw new Error("ไม่พบข้อมูลสินค้าในใบโอน");
        // ★ 1:1 satang → cents (ไม่สเกล) — ต้นทุนที่พกมากับใบ (null = 0 · ไม่ทับต้นทุนเดิม CF ด้าน receive)
        const unitCostSatang = Math.max(0, Math.trunc(line.unitCostSatang ?? 0));
        const { cfProductId } = await resolveClawfleetProduct(
          orgId,
          { id: dp.id, sku: dp.sku, barcode: dp.barcode, name: dp.name, imageUrl: toImageUrl(dp.imageR2Path) },
          unitCostSatang,
          userId,
        );
        cfLinesByLineId.set(line.id, { cfProductId, unitCostSatang });
      }
    } catch (e) {
      // mapping พัง → ยังไม่ reserve/confirm อะไรเลย → คืน error ให้ผู้ใช้เห็นชัด (retry ได้)
      return { ok: false, error: e instanceof Error ? e.message : "จับคู่สินค้าเข้าสโตร์สาขาไม่สำเร็จ" };
    }
  }

  // map qtyReceived ที่ส่งมา (รายบรรทัด) → default = qty เต็ม (รับครบ)
  // ★ MONEY GUARD (server-side cap): รับได้ไม่เกิน "จำนวนที่ส่งออกจริง" ของบรรทัดนั้น (line.qty).
  //   ถ้าไม่ cap: client ส่ง qtyReceived=999 ทั้งที่ส่งออก 5 → สต๊อก+ต้นทุนเฉลี่ย CF พองผิด · in-transit ลดแค่ 5
  //   (เดิม trust client · path นี้เพิ่งเปิดให้ staff มือถือกดรับ → ต้อง clamp ที่ server ไม่ใช่แค่ UI · [[money-feature-client-preview-must-match-server]]).
  const dispatchedByLine = new Map(transfer.lines.map((l) => [l.id, l.qty]));
  const recvByLine = new Map<string, number>();
  for (const r of input.lines ?? []) {
    if (r.lineId && Number.isFinite(r.qtyReceived)) {
      const cap = dispatchedByLine.get(r.lineId) ?? 0; // lineId ไม่ตรงใบ → cap 0 → ถูกละทิ้ง
      recvByLine.set(r.lineId, Math.min(cap, Math.max(0, Math.trunc(r.qtyReceived))));
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ★ FIX 1 — CROSS-SCHEMA ATOMICITY (SHARED TX) · ปลายทาง = สาขาตู้คีบ (ClawFleet)
  // ══════════════════════════════════════════════════════════════════════
  // ปัญหาเดิม: status-claim → decrement in-transit → CF-write ทำ "แยกกัน" → ถ้า CF-write พัง
  //   in-transit ที่ลดไปแล้ว "ไม่ถูกคืน" (stock loss) + retry ลดซ้ำ (double-decrement).
  // แก้: ทำ 4 อย่างใน $transaction เดียว (Prisma multiSchema = DB เดียว → 1 tx ครอบ dc + public ได้):
  //   (1) atomic status-claim IN_TRANSIT→CONFIRMED (updateMany · count===0 = คนอื่นชนะไปแล้ว → sentinel)
  //   (2) อัปเดต qtyReceived รายบรรทัด (tx)
  //   (3) ลด in-transit ต้นทาง (tx · atomic decrement · gated ด้วย claim ข้อ 1 → ทำครั้งเดียว)
  //   (4) receiveDcTransferIntoBranchTx(tx, …) เขียนสต๊อก+ต้นทุน CF (idempotency guard refTable/refId ใน tx)
  //  ถ้า "อะไรก็ตาม" ใน tx throw (ยกเว้น sentinel) → rollback ทั้งก้อน → ใบยัง IN_TRANSIT · in-transit ครบ ·
  //  CF ไม่ถูกเขียน → คืน error retryable. mapping resolve (resolveClawfleetProduct) ทำ "นอก" tx แล้ว
  //  (อาจ auto-create CfProduct · idempotent) → tx สั้น.
  const ALREADY_CONFIRMED = "__ALREADY_CONFIRMED__";
  if (isClawfleetDest && transfer.toBranchId && cfLinesByLineId) {
    const branchId = transfer.toBranchId;
    const cfMap = cfLinesByLineId;
    try {
      await prisma.$transaction(async (tx) => {
        // (1) atomic status-claim — คนเดียวที่ count===1 เท่านั้นเดินต่อ
        const claim = await tx.dcTransfer.updateMany({
          where: { id: transferId, orgId, status: DcTransferStatus.IN_TRANSIT },
          data: { status: DcTransferStatus.CONFIRMED, confirmedByUserId: userId, confirmedAt: new Date() },
        });
        if (claim.count === 0) {
          // ใบถูกยืนยันไปแล้ว (กดซ้ำ/แข่งแพ้/cron) → sentinel → rollback (ไม่ทำ 2-4) → นอก tx คืน ok
          throw new Error(ALREADY_CONFIRMED);
        }

        // (2) qtyReceived รายบรรทัด + (3) ลด in-transit ต้นทาง (atomic decrement บน tx)
        const cfLines: { cfProductId: string; qty: number; unitCostSatang: number }[] = [];
        for (const line of transfer.lines) {
          const received = recvByLine.has(line.id) ? (recvByLine.get(line.id) as number) : line.qty;
          await tx.dcTransferLine.update({ where: { id: line.id }, data: { qtyReceived: received } });

          // ลด in-transit ต้นทางตามจำนวนที่ "ส่งออก" (qty) — ของออกจาก in-transit ครบ (mirror decrementSourceInTransit)
          await decrementSourceInTransitTx(tx, transfer.fromWarehouseId, line.productId, line.qty);

          const m = cfMap.get(line.id);
          if (m && received > 0) {
            cfLines.push({ cfProductId: m.cfProductId, qty: received, unitCostSatang: m.unitCostSatang });
          }
        }

        // (4) เขียนสต๊อก+ต้นทุน ClawFleet ใน tx เดียวกัน (idempotency refTable/refId ใน tx)
        if (cfLines.length > 0) {
          await receiveDcTransferIntoBranchTx(tx, {
            orgId,
            branchId,
            transferId,
            transferCode: transfer.transferCode,
            actorUserId: userId,
            lines: cfLines,
          });
        }
      }, { timeout: 20000, maxWait: 5000 });
      // ↑ tx นี้หลายบรรทัด + advisory lock (บล็อกได้) → default 5s แคบไป · ตั้ง 20s กัน rollback หลอก
      //   (ยัง safe: timeout = rollback = ไม่มี partial write · retry ผ่าน claim+idempotency)
    } catch (e) {
      // sentinel = ใบถูกยืนยันไปแล้ว → ถือว่าสำเร็จ (ไม่ใช่ error) · rollback ทำให้ไม่มีผลข้างเคียง
      if (e instanceof Error && e.message === ALREADY_CONFIRMED) return { ok: true };
      // อื่น ๆ = rollback ทั้งก้อน (ใบยัง IN_TRANSIT · in-transit ครบ · CF ว่าง) → คืน error retryable
      return {
        ok: false,
        error:
          (e instanceof Error ? e.message : "เขียนสต๊อกเข้าสโตร์สาขาไม่สำเร็จ") + " — ลองกดยืนยันรับอีกครั้ง",
      };
    }
    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════════════════
  // NON-ClawFleet paths (WAREHOUSE dest · plain MODULE label) — โครงสร้างเดิม (ไม่แตะ)
  // ══════════════════════════════════════════════════════════════════════
  // ★ ATOMIC STATUS-RESERVE (จังหวะแรก · ก่อนแตะของ): จองสถานะเป็น CONFIRMED ทันที
  // เงื่อนไข WHERE status=IN_TRANSIT → คนเดียวเท่านั้นที่ count===1 (ชนะการแข่ง).
  // ใครมาทีหลัง/cron/กดซ้ำ → row ไม่ใช่ IN_TRANSIT แล้ว → count===0 → คืน ok เลย
  // โดยไม่รัน movement/decrement ซ้ำ → รับประกัน decrement in-transit "ทำครั้งเดียว".
  const reserved = await prisma.dcTransfer.updateMany({
    where: { id: transferId, orgId, status: DcTransferStatus.IN_TRANSIT },
    data: {
      status: DcTransferStatus.CONFIRMED,
      confirmedByUserId: userId,
      confirmedAt: new Date(),
    },
  });
  if (reserved.count === 0) {
    // แพ้การแข่ง / ใบถูกปิดไปแล้วระหว่างทาง → ถือว่าสำเร็จ ไม่รันซ้ำ
    return { ok: true };
  }

  const isWarehouseDest = transfer.destType === DcTransferDestType.WAREHOUSE && !!transfer.toWarehouseId;
  const destWh = transfer.toWarehouseId;

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const received = recvByLine.has(line.id) ? (recvByLine.get(line.id) as number) : line.qty;

        // บันทึก qtyReceived รายบรรทัด
        await tx.dcTransferLine.update({
          where: { id: line.id },
          data: { qtyReceived: received },
        });
      }
    });

    // movement + balance ทำนอก tx ของ line-update เพื่อใช้ recordMovement (มี tx ของตัวเอง · idempotent)
    if (isWarehouseDest && destWh) {
      for (const line of transfer.lines) {
        const received = recvByLine.has(line.id) ? (recvByLine.get(line.id) as number) : line.qty;
        if (received > 0) {
          const inRes = await recordMovement({
            orgId,
            warehouseId: destWh,
            productId: line.productId,
            kind: DcMoveKind.TRANSFER_IN,
            qty: received,
            unitCostSatang: line.unitCostSatang,
            costLayerId: line.costLayerId,
            sourceKey: sourceKey("tfi", transferId, line.id),
            refType: "dc_transfer",
            refId: transferId,
            note: `รับโอน ${transfer.transferCode}`,
            actorUserId: userId,
          });
          if (!inRes.ok) throw new Error(inRes.error);
        }
        // ลด in-transit ต้นทาง ตามจำนวนที่ "ส่งออก" (qty) — ของออกจาก in-transit ครบ
        // (ส่วนต่าง qty−received คือของหาย/เสียหาย: ออกจาก in-transit แต่ไม่เข้าปลายทาง)
        await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
      }
    } else {
      // MODULE dest (ปลายทาง label อิสระ · ไม่ใช่สาขาตู้คีบ) → ปิดใบเฉย ๆ: ลด in-transit ต้นทาง.
      //   (ClawFleet-dest ถูกจัดการไปก่อนแล้วใน SHARED TX ด้านบน + return · ไม่มาถึงตรงนี้)
      for (const line of transfer.lines) {
        await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
      }
    }
    // หมายเหตุ: สถานะ CONFIRMED + confirmedBy/At ถูกตั้งไปแล้วตอน ATOMIC STATUS-RESERVE
    // ด้านบน (ผู้ชนะการแข่งเท่านั้นที่มาถึงตรงนี้) — ไม่ต้องเขียน status ซ้ำอีก.
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยืนยันรับโอนไม่สำเร็จ" };
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
// cancel (ยกเลิก — คืนของกลับต้นทาง)
// ════════════════════════════════════════════════════════════════════

export type CancelTransferResult = { ok: true } | { ok: false; error: string };

/**
 * ยกเลิกใบโอน — ได้เฉพาะที่ยังไม่ปิด (IN_TRANSIT/DISPATCHED).
 * คืนของกลับ qtyOnHand ต้นทาง + ลด in-transit ต้นทาง (กลับสภาพก่อนส่ง) + สถานะ CANCELLED.
 */
export async function cancelTransfer(transferId: string): Promise<CancelTransferResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ยกเลิกใบโอน" };
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const id = (transferId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบโอน" };

  const transfer = await prisma.dcTransfer.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      status: true,
      lines: { select: { id: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true, poId: true } },
    },
  });
  if (!transfer) return { ok: false, error: "ไม่พบใบโอน" };

  if (transfer.status !== DcTransferStatus.IN_TRANSIT && transfer.status !== DcTransferStatus.DISPATCHED) {
    return { ok: false, error: "ยกเลิกได้เฉพาะใบที่ยังกำลังส่ง (ยังไม่ปิด)" };
  }

  try {
    // คืนของกลับต้นทาง: RETURN_IN (qty +n) + ลด in-transit −n · idempotent ต่อบรรทัด
    for (const line of transfer.lines) {
      const back = await recordMovement({
        orgId,
        warehouseId: transfer.fromWarehouseId,
        productId: line.productId,
        kind: DcMoveKind.RETURN_IN,
        qty: Math.abs(line.qty),
        inTransitDelta: -Math.abs(line.qty),
        poId: line.poId, // Pinpoint #2 — คืน po_id เดิม → getPoFulfillment net movedOut กลับเป็น 0
        unitCostSatang: line.unitCostSatang,
        costLayerId: line.costLayerId,
        sourceKey: sourceKey("tfcancel", id, line.id),
        refType: "dc_transfer_cancel",
        refId: id,
        note: `ยกเลิกใบโอน ${transfer.transferCode} — คืนของกลับคลัง`,
        actorUserId: userId,
      });
      if (!back.ok) throw new Error(back.error);
    }

    await prisma.dcTransfer.update({
      where: { id },
      data: { status: DcTransferStatus.CANCELLED },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยกเลิกใบโอนไม่สำเร็จ" };
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
// autoPromoteStaleTransfers (เรียกจาก reconcile job)
// ════════════════════════════════════════════════════════════════════

export type AutoPromoteResult = {
  ok: true;
  promotedWarehouse: number;
  promotedModule: number;
};

/**
 * ใบ IN_TRANSIT ที่ค้างเกิน N ชม. → ปิดอัตโนมัติแบบ "ติดธง" (ไม่หายเงียบ ๆ):
 *   • WAREHOUSE dest → รับเข้าปลายทางอัตโนมัติ (TRANSFER_IN ครบตาม qty) + ลด in-transit + status=AUTO_UNVERIFIED
 *   • MODULE dest    → ปิด in-transit + status=AUTO_UNVERIFIED (ไม่เขียนเข้าโมดูลอื่น)
 * EXPORT — reconcile job เรียกตัวนี้. ไม่ต้องมี session (system job) → scope ด้วย orgId ที่ส่งมา.
 */
export async function autoPromoteStaleTransfers(
  orgId: string,
  olderThanHours = 48,
): Promise<AutoPromoteResult> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const stale = await prisma.dcTransfer.findMany({
    where: {
      orgId,
      status: DcTransferStatus.IN_TRANSIT,
      dispatchedAt: { lt: cutoff },
    },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      destType: true,
      toWarehouseId: true,
      lines: { select: { id: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true } },
    },
  });

  let promotedWarehouse = 0;
  let promotedModule = 0;

  for (const transfer of stale) {
    const isWarehouseDest = transfer.destType === DcTransferDestType.WAREHOUSE && !!transfer.toWarehouseId;
    const destWh = transfer.toWarehouseId;

    // ★ ATOMIC RESERVE ต่อใบ (จังหวะแรก · ก่อนรับเข้า/ลด in-transit): จองสถานะ
    // IN_TRANSIT → AUTO_UNVERIFIED ทันที. ถ้า count===0 = ใบนี้ถูกจัดการไปแล้ว
    // (manual confirmTransfer ชนะไปก่อน / cron รอบก่อน / รอบนี้รันซ้อน) → ข้าม
    // ไม่รับเข้า/ลด in-transit ซ้ำ. คนชนะเท่านั้น (count===1) ถึงเดินต่อ.
    const reserved = await prisma.dcTransfer.updateMany({
      where: { id: transfer.id, orgId, status: DcTransferStatus.IN_TRANSIT },
      data: {
        status: DcTransferStatus.AUTO_UNVERIFIED,
        confirmedAt: new Date(),
      },
    });
    if (reserved.count === 0) continue;

    try {
      if (isWarehouseDest && destWh) {
        for (const line of transfer.lines) {
          const inRes = await recordMovement({
            orgId,
            warehouseId: destWh,
            productId: line.productId,
            kind: DcMoveKind.TRANSFER_IN,
            qty: Math.abs(line.qty),
            unitCostSatang: line.unitCostSatang,
            costLayerId: line.costLayerId,
            sourceKey: sourceKey("tfi", transfer.id, line.id),
            refType: "dc_transfer_auto",
            refId: transfer.id,
            note: `รับโอนอัตโนมัติ ${transfer.transferCode} (ค้างเกิน ${olderThanHours} ชม.)`,
            actorUserId: null,
          });
          if (!inRes.ok) throw new Error(inRes.error);
          await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
          await prisma.dcTransferLine.update({
            where: { id: line.id },
            data: { qtyReceived: line.qty },
          });
        }
        promotedWarehouse += 1;
      } else {
        // MODULE dest (รวมสาขาตู้คีบ ClawFleet) → ปิด in-transit + ติดธง AUTO_UNVERIFIED เท่านั้น.
        // ★ Wave 6: ปลายทาง ClawFleet "ห้าม" auto-เขียนสต๊อก/ต้นทุนเข้าสโตร์สาขาที่นี่ — งานเงินต้องมีคน
        //   ยืนยันรับด้วยมือ (confirmTransfer) เท่านั้น. cron แค่กันใบค้างหาย (ติดธง) ไม่แตะเงินอัตโนมัติ.
        for (const line of transfer.lines) {
          await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
        }
        promotedModule += 1;
      }
      // หมายเหตุ: status=AUTO_UNVERIFIED + confirmedAt ถูกตั้งไปแล้วตอน ATOMIC RESERVE
      // ด้านบน (ใบที่ชนะ reserve เท่านั้นที่มาถึงตรงนี้) — ไม่ต้องเขียน status ซ้ำ.
    } catch {
      // ใบนี้พลาด → ข้ามไปทำใบถัดไป (ไม่ทำให้ทั้ง job ล้ม)
      // status ถูกตั้งเป็น AUTO_UNVERIFIED แล้ว (ติดธงไว้ ไม่หายเงียบ ๆ) ตั้งแต่ reserve.
      continue;
    }
  }

  return { ok: true, promotedWarehouse, promotedModule };
}
