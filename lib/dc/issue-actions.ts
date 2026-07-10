"use server";

// DC Warehouse · FLOOR "เบิกออก" (issue) + "ย้ายที่" (move) — server actions.
//
// ทุก action: requireSession + canDcFloor(role) (ไม่ผ่าน = throw) · scope ด้วย
// orgId เสมอ · เบิก/ย้ายต้องอยู่ในคลังที่ผู้ใช้เข้าถึงได้ (assertWarehouseAllowed).
//
// ★ IDEMPOTENCY: ทุกบรรทัดพก lineKey (uuid จาก client) → sourceKey("issue"/"move",
//   lineKey) → @@unique([orgId, sourceKey]) ทำให้กดซ้ำ/รีทรายเป็น no-op (duplicate)
//   ไม่หักสต๊อก/ย้ายซ้ำ. (กับดักเดิม PlaylandStockMovement ไม่มี key — ห้ามซ้ำรอย.)
//
// ★ NO-NEGATIVE: เบิกออกผ่าน recordMovement (qty ติดลบ) → ถ้าสต๊อกไม่พอ engine
//   คืน {ok:false,error} โดยไม่แตะ balance (atomic). เก็บ error รายบรรทัด → คืน partial.

import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { sourceKey, genCode } from "@/lib/dc/codes";
import { prisma } from "@/lib/prisma";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import { recordMovement, findProductByCode, getOnHand } from "@/lib/dc/stock";

/** Guard: ต้อง login + มีสิทธิ์ทำงานหน้าคลัง. คืน {orgId, userId}. */
async function requireFloor(): Promise<{ orgId: string; userId: string }> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์ทำงานหน้าคลัง");
  }
  return { orgId: session.user.org_id, userId: session.user.id };
}

/**
 * สร้าง/หา "หัวใบเบิก" แบบ idempotent ด้วย batchKey (เซ็ตของบรรทัดที่เบิก).
 * กดเบิกซ้ำ (ชุดเดิม) → คืนใบเดิม ไม่สร้างซ้ำ. ชน unique (race) → อ่านซ้ำ.
 */
async function ensureIssueHeader(orgId: string, warehouseId: string, batchKey: string, userId: string): Promise<string> {
  const existing = await prisma.dcIssue.findFirst({ where: { orgId, batchKey }, select: { id: true } });
  if (existing) return existing.id;
  try {
    const created = await prisma.dcIssue.create({
      data: { orgId, issueCode: genCode("ISS"), warehouseId, batchKey, actorUserId: userId },
      select: { id: true },
    });
    return created.id;
  } catch {
    const again = await prisma.dcIssue.findFirst({ where: { orgId, batchKey }, select: { id: true } });
    if (again) return again.id;
    throw new Error("สร้างหัวใบเบิกไม่สำเร็จ");
  }
}

/** สร้าง/หา "หัวใบย้าย" แบบ idempotent ด้วย batchKey. */
async function ensureMoveHeader(orgId: string, warehouseId: string, batchKey: string, userId: string): Promise<string> {
  const existing = await prisma.dcMove.findFirst({ where: { orgId, batchKey }, select: { id: true } });
  if (existing) return existing.id;
  try {
    const created = await prisma.dcMove.create({
      data: { orgId, moveCode: genCode("MOV"), warehouseId, batchKey, actorUserId: userId },
      select: { id: true },
    });
    return created.id;
  } catch {
    const again = await prisma.dcMove.findFirst({ where: { orgId, batchKey }, select: { id: true } });
    if (again) return again.id;
    throw new Error("สร้างหัวใบย้ายไม่สำเร็จ");
  }
}

/** อ่านตำแหน่งจัดเก็บปัจจุบันของสินค้าในคลัง (null ถ้ายังไม่เคยกำหนด). */
async function getLocation(warehouseId: string, productId: string): Promise<string | null> {
  const b = await prisma.dcStockBalance.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
    select: { location: true },
  });
  return b?.location ?? null;
}

// ════════════════════════════════════════════════════════════════════
// เบิกออก (issue)
// ════════════════════════════════════════════════════════════════════

export type LookupForIssueResult =
  | {
      ok: true;
      product: {
        id: string;
        name: string;
        sku: string;
        unit: string;
        onHand: number;
        location: string | null;
      };
    }
  | { ok: false; error: string };

/**
 * ค้นหาสินค้าจากบาร์โค้ด/SKU + อ่านยอดคงเหลือ + ตำแหน่งในคลังที่ระบุ.
 * ใช้ตอนสแกน/พิมพ์รหัสหน้าเบิกออก. scope ด้วย orgId ของผู้ใช้.
 */
export async function lookupForIssue(args: {
  warehouseId: string;
  code: string;
}): Promise<LookupForIssueResult> {
  const { orgId } = await requireFloor();

  const code = (args.code ?? "").trim();
  if (!code) return { ok: false, error: "กรุณากรอกรหัส" };

  const wh = (args.warehouseId ?? "").trim();
  if (!wh) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };

  const product = await findProductByCode(orgId, code);
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  const onHand = await getOnHand(wh, product.id);
  const location = await getLocation(wh, product.id);

  return {
    ok: true,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit ?? "ชิ้น",
      onHand,
      location,
    },
  };
}

export type IssueLine = {
  productId: string;
  qty: number;
  /** เหตุผล / เบิกไปไหน (ไม่บังคับ) */
  reason?: string;
  /** uuid ต่อบรรทัด (client สร้างตอนเพิ่ม) — ใช้ทำ idempotency key */
  lineKey: string;
};

export type PostIssueInput = {
  warehouseId: string;
  lines: IssueLine[];
};

export type PostIssueResult =
  | { ok: true; posted: number; failed: { productId: string; error: string }[]; issueId: string }
  | { ok: false; error: string };

/**
 * เบิกออกหลายบรรทัดในครั้งเดียว.
 * - ตรวจสิทธิ์ floor + ยืนยันคลังอยู่ในขอบเขตของผู้ใช้ (org + allowed).
 * - แต่ละบรรทัด recordMovement(kind=ISSUE, qty ติดลบ) — atomic + idempotent.
 * - บรรทัดที่สต๊อกไม่พอ (หรือพังอื่น ๆ) เก็บเข้า failed แล้ว "ไปต่อ" บรรทัดถัดไป
 *   → คืนผลแบบ partial (posted + failed) ไม่ทำให้ทั้งใบล้ม.
 */
export async function postIssue(input: PostIssueInput): Promise<PostIssueResult> {
  const { orgId, userId } = await requireFloor();

  const warehouseId = (input.warehouseId ?? "").trim();
  if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };

  const session = await requireSession();
  try {
    await assertWarehouseAllowed(session, warehouseId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  // กรองบรรทัดที่ใช้ได้ (qty > 0 + มี productId + lineKey)
  const lines = (input.lines ?? []).filter(
    (l) => l.productId && l.lineKey && Number.isFinite(l.qty) && l.qty > 0,
  );
  if (lines.length === 0) return { ok: false, error: "ยังไม่มีรายการเบิกออก" };

  // กันยิงซ้ำ lineKey เดิมในใบเดียว — เก็บอันแรกไว้
  const seen = new Set<string>();
  const uniqueLines = lines.filter((l) => {
    if (seen.has(l.lineKey)) return false;
    seen.add(l.lineKey);
    return true;
  });

  // สร้าง "หัวใบเบิก" ก่อน (idempotent · batchKey = เซ็ตของ lineKeys ที่เบิก) → ผูก movement เข้าใบ
  const batchKey = "issue:" + uniqueLines.map((l) => l.lineKey).sort().join(",");
  const issueId = await ensureIssueHeader(orgId, warehouseId, batchKey, userId);

  const failed: { productId: string; error: string }[] = [];
  let posted = 0;

  for (const line of uniqueLines) {
    const qty = Math.trunc(line.qty);
    if (qty <= 0) continue;
    const reason = (line.reason ?? "").trim();
    const res = await recordMovement({
      orgId,
      warehouseId,
      productId: line.productId,
      kind: DcMoveKind.ISSUE,
      qty: -Math.abs(qty), // เบิกออก = ติดลบ
      sourceKey: sourceKey("issue", line.lineKey),
      refType: "dc_issue", // ผูกกับหัวใบเบิก (เดิม floor_issue) → พิมพ์เป็นเอกสารได้
      refId: issueId,
      note: reason || "เบิกออก",
      actorUserId: userId,
    });

    if (!res.ok) {
      // สต๊อกไม่พอ ฯลฯ → เก็บไว้ แล้วทำบรรทัดอื่นต่อ
      failed.push({ productId: line.productId, error: res.error });
      continue;
    }
    posted += 1;
  }

  return { ok: true, posted, failed, issueId };
}

// ════════════════════════════════════════════════════════════════════
// ย้ายที่ (move location)
// ════════════════════════════════════════════════════════════════════

export type LookupForMoveResult =
  | {
      ok: true;
      product: {
        id: string;
        name: string;
        sku: string;
        onHand: number;
        location: string | null;
      };
    }
  | { ok: false; error: string };

/**
 * ค้นหาสินค้าจากบาร์โค้ด/SKU + อ่านยอดคงเหลือ + ตำแหน่งปัจจุบัน.
 * ใช้ตอนสแกน/พิมพ์รหัสหน้าย้ายที่.
 */
export async function lookupForMove(args: {
  warehouseId: string;
  code: string;
}): Promise<LookupForMoveResult> {
  const { orgId } = await requireFloor();

  const code = (args.code ?? "").trim();
  if (!code) return { ok: false, error: "กรุณากรอกรหัส" };

  const wh = (args.warehouseId ?? "").trim();
  if (!wh) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };

  const product = await findProductByCode(orgId, code);
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  const onHand = await getOnHand(wh, product.id);
  const location = await getLocation(wh, product.id);

  return {
    ok: true,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      onHand,
      location,
    },
  };
}

export type MoveLocationResult =
  | { ok: true; location: string; moveId: string }
  | { ok: false; error: string };

/**
 * ย้ายตำแหน่งจัดเก็บของสินค้าในคลัง (qty=0 location-only).
 * - อ่านตำแหน่งปัจจุบันเป็น from → recordMovement(kind=MOVE) อัปเดต balance.location.
 * - idempotent ด้วย sourceKey("move", lineKey) — กดซ้ำ = no-op.
 */
export async function moveLocation(args: {
  warehouseId: string;
  productId: string;
  toLocation: string;
  lineKey: string;
}): Promise<MoveLocationResult> {
  const { orgId, userId } = await requireFloor();

  const warehouseId = (args.warehouseId ?? "").trim();
  if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };

  const productId = (args.productId ?? "").trim();
  if (!productId) return { ok: false, error: "ยังไม่ได้เลือกสินค้า" };

  const lineKey = (args.lineKey ?? "").trim();
  if (!lineKey) return { ok: false, error: "ไม่พบรหัสรายการ" };

  const toLocation = (args.toLocation ?? "").trim();
  if (!toLocation) return { ok: false, error: "กรุณากรอกตำแหน่งใหม่" };

  const session = await requireSession();
  try {
    await assertWarehouseAllowed(session, warehouseId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  const from = await getLocation(warehouseId, productId);

  // สร้าง "หัวใบย้าย" (idempotent · batchKey = lineKey) → ผูก movement เข้าใบ
  const moveId = await ensureMoveHeader(orgId, warehouseId, "move:" + lineKey, userId);

  const res = await recordMovement({
    orgId,
    warehouseId,
    productId,
    kind: DcMoveKind.MOVE,
    qty: 0, // ย้ายที่ = ไม่เปลี่ยนจำนวน
    locationFrom: from,
    locationTo: toLocation,
    sourceKey: sourceKey("move", lineKey),
    refType: "dc_move", // ผูกกับหัวใบย้าย (เดิม floor_move)
    refId: moveId,
    note: from ? `ย้าย ${from} → ${toLocation}` : `ตั้งตำแหน่ง ${toLocation}`,
    actorUserId: userId,
  });

  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, location: toLocation, moveId };
}
