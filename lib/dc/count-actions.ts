"use server";

// DC Warehouse · FLOOR "นับสต๊อก" (stock count) — server actions.
//
// หน้านี้คือหน้าเดียวที่ต้องทำงานได้แม้เน็ตหลุด (back-of-house) → ฝั่ง client
// บัฟเฟอร์รายการนับไว้ใน localStorage แล้วค่อย "ซิงค์" เข้ามาทีหลัง. ฝั่ง server
// idempotent ผ่าน sourceKey("count", lineKey) → ยิงซ้ำ = no-op (กันนับเบิลตอน retry).
//
// แนวคิด: เรา "นับได้เท่าไร" (countedQty) แล้วระบบคิด delta = นับ − ของในระบบ
// ตอน "ซิงค์" จริง (ไม่ trust delta จาก client เพราะ on-hand อาจเปลี่ยนระหว่างหลุดเน็ต)
// → ทุก line จึงเก็บแค่ productId + countedQty + lineKey. ไม่มีเรื่องต้นทุน/เงินในไฟล์นี้.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed, getAllowedWarehouses } from "@/lib/dc/access";
import { findProductByCode, getOnHand, recordMovement } from "@/lib/dc/stock";
import { sourceKey, genCode } from "@/lib/dc/codes";
import { MOVE_KIND_LABEL } from "@/lib/dc/nav";
import { DcMoveKind } from "@/lib/generated/prisma/enums";

export type LookupForCountResult =
  | {
      ok: true;
      product: { id: string; name: string; sku: string; unit: string | null; systemQty: number };
    }
  | { ok: false; error: string };

/**
 * หาสินค้าจากบาร์โค้ด/รหัส + ดึงยอดในระบบ (systemQty) เพื่อตั้งค่าเริ่มต้นช่องนับ.
 * ใช้ตอน online เท่านั้น — offline จะไป resolve ตอนซิงค์.
 */
export async function lookupForCount(input: {
  warehouseId: string;
  code: string;
}): Promise<LookupForCountResult> {
  try {
    const session = await requireSession();
    const orgId = session.user.org_id;
    await assertWarehouseAllowed(session, input.warehouseId);

    const product = await findProductByCode(orgId, input.code);
    if (!product) {
      return { ok: false, error: `ไม่พบสินค้ารหัส "${input.code.trim()}"` };
    }
    const systemQty = await getOnHand(input.warehouseId, product.id);
    return {
      ok: true,
      product: { id: product.id, name: product.name, sku: product.sku, unit: product.unit, systemQty },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ค้นหาสินค้าไม่สำเร็จ" };
  }
}

/**
 * รายชื่อ "หมวดหมู่" (category) ที่ไม่ว่าง ของสินค้า active ในองค์กร (distinct).
 * category เป็น free-text → group + เรียงตามตัวอักษร. ใช้ทำ filter ในหน้านับ (online เท่านั้น).
 */
export async function listCategoriesForCount(): Promise<string[]> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return [];
    const orgId = session.user.org_id;

    const rows = await prisma.dcProduct.findMany({
      where: { orgId, active: true, category: { not: null } },
      distinct: ["category"],
      orderBy: { category: "asc" },
      select: { category: true },
    });
    return rows
      .map((r) => (r.category ?? "").trim())
      .filter((c) => c.length > 0);
  } catch {
    return [];
  }
}

export type CountProductRow = {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  systemQty: number;
  imageUrl: string | null; // รูปสินค้า (resolve เป็น URL เต็มฝั่ง server แล้ว) · null = ไม่มีรูป
};

export type ListProductsForCountResult =
  | { ok: true; products: CountProductRow[] }
  | { ok: false; error: string };

/**
 * รายการสินค้า active ในองค์กร (กรอง category + ค้นหา q ได้) พร้อมยอดในระบบ (systemQty)
 * ของคลังที่กำลังนับ. ใช้สำหรับหน้า "ดูสินค้าทั้งหมด" → กดเลือกสินค้าที่จะนับเอง (online เท่านั้น).
 *  • systemQty = qtyOnHand ใน dcStockBalance ของคลังนั้น (0 ถ้าไม่มีแถว balance)
 *  • limit ~200 (กันโหลดยาวบนมือถือ)
 */
export async function listProductsForCount(input: {
  warehouseId: string;
  category?: string;
  q?: string;
}): Promise<ListProductsForCountResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์นับสต๊อก" };
    }
    await assertWarehouseAllowed(session, input.warehouseId);
    const orgId = session.user.org_id;

    const category = (input.category ?? "").trim();
    const q = (input.q ?? "").trim();

    const products = await prisma.dcProduct.findMany({
      where: {
        orgId,
        active: true,
        ...(category ? { category } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { barcode: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      take: 200,
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        unit: true,
        imageR2Path: true,
        // ดึงเฉพาะ balance ของคลังที่นับ → systemQty
        balances: {
          where: { warehouseId: input.warehouseId },
          select: { qtyOnHand: true },
          take: 1,
        },
      },
    });

    // resolve รูปเป็น URL เต็มฝั่ง server (client อ่าน env ไม่ได้)
    const r2Public = process.env.R2_PUBLIC_URL ?? "";
    const toImageUrl = (key: string | null): string | null =>
      !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

    return {
      ok: true,
      // ซ่อนสินค้าที่คงเหลือ = 0 ในคลังนี้ (ของใช้แล้วหมดไป · CEO ขอ) — ยังสแกนตัวจริงได้ปกติ
      products: products
        .filter((p) => (p.balances[0]?.qtyOnHand ?? 0) > 0)
        .map((p) => ({
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          unit: p.unit,
          systemQty: p.balances[0]?.qtyOnHand ?? 0,
          imageUrl: toImageUrl(p.imageR2Path),
        })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการสินค้าไม่สำเร็จ" };
  }
}

export type SyncCountLine = { productId: string; countedQty: number; lineKey: string };

export type CountSyncLineResult = {
  productId: string;
  lineKey: string;
  systemQty: number; // on-hand ณ ตอนซิงค์ (ก่อนปรับ) = "ระบบมี"
  countedQty: number;
  delta: number; // = variance (countedQty − systemQty)
  balanceAfter: number;
};

export type SyncCountsResult =
  | {
      ok: true;
      synced: string[];
      results: { productId: string; delta: number; balanceAfter: number }[];
    }
  | { ok: false; error: string };

/**
 * CORE: ปรับสต๊อกตามรายการนับ (ไม่แตะเอกสารใบนับ — ใช้ทั้ง syncCounts เดิม + saveCountSheet).
 *  • systemQty (ระบบมี) คิดสด ณ ตอนซิงค์ (on-hand ปัจจุบัน) — ไม่เชื่อ client
 *  • delta = countedQty − systemQty
 *  • delta !== 0 → recordMovement(COUNT_ADJUST) ด้วย sourceKey("count", lineKey)
 *    → ยิงซ้ำ = no-op (idempotent ที่ DB · IDEMPOTENCY เดิม ห้ามเปลี่ยน) → re-sync ปลอดภัย
 *  • delta === 0 → ไม่บันทึก movement แต่ถือว่า "ซิงค์แล้ว" (คืน lineKey)
 *  • refType/refId: ใส่ผูกกับหัวใบนับได้ (dc_count) — ถ้าไม่ใส่ = "floor_count" เดิม
 * คืน per-line result (มี systemQty/variance) เพื่อให้ผู้เรียกเก็บ snapshot ลงบรรทัดใบนับได้.
 * ★ ไม่ throw ต่อบรรทัด: บรรทัดที่พัง → คืน {ok:false} ทันที (คงพฤติกรรม syncCounts เดิม).
 */
async function applyCountLines(args: {
  orgId: string;
  warehouseId: string;
  userId: string;
  lines: SyncCountLine[];
  refType?: string;
  refId?: string | null;
}):
  | Promise<
      | { ok: true; synced: string[]; lineResults: CountSyncLineResult[] }
      | { ok: false; error: string }
    > {
  const synced: string[] = [];
  const lineResults: CountSyncLineResult[] = [];

  for (const line of args.lines) {
    const lineKey = String(line.lineKey || "").trim();
    const productId = String(line.productId || "").trim();
    const counted = Number(line.countedQty);
    // ข้ามรายการที่ข้อมูลไม่ครบ (offline ที่ยังหาสินค้าไม่เจอ) — ไม่ mark synced
    if (!lineKey || !productId || !Number.isFinite(counted)) continue;

    const current = await getOnHand(args.warehouseId, productId);
    const delta = counted - current;

    if (delta === 0) {
      // ไม่มีส่วนต่าง → ไม่บันทึก movement แต่ถือว่าซิงค์เรียบร้อย
      synced.push(lineKey);
      lineResults.push({ productId, lineKey, systemQty: current, countedQty: counted, delta: 0, balanceAfter: current });
      continue;
    }

    const res = await recordMovement({
      orgId: args.orgId,
      warehouseId: args.warehouseId,
      productId,
      kind: DcMoveKind.COUNT_ADJUST,
      qty: delta,
      sourceKey: sourceKey("count", lineKey), // ★ IDEMPOTENCY เดิม — ห้ามเปลี่ยน
      refType: args.refType ?? "floor_count",
      refId: args.refId ?? undefined,
      actorUserId: args.userId,
      note: `นับได้ ${counted}`,
    });
    if (!res.ok) {
      // ปล่อย line นี้ค้าง (ไม่ push synced) → ผู้ใช้ลองซิงค์ใหม่ได้
      return { ok: false, error: res.error };
    }
    synced.push(lineKey);
    lineResults.push({ productId, lineKey, systemQty: current, countedQty: counted, delta, balanceAfter: res.balanceAfter });
  }

  return { ok: true, synced, lineResults };
}

/**
 * ซิงค์รายการนับที่บัฟเฟอร์ไว้เข้าระบบ (ปรับสต๊อกอย่างเดียว · ไม่สร้างเอกสารใบนับ).
 * คงไว้เพื่อ backward-compat / auto-sync — ตัวหลักที่หน้าใช้ตอน "บันทึกใบนับ" คือ saveCountSheet.
 */
export async function syncCounts(input: {
  warehouseId: string;
  lines: SyncCountLine[];
}): Promise<SyncCountsResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์นับสต๊อก" };
    }
    await assertWarehouseAllowed(session, input.warehouseId);

    const core = await applyCountLines({
      orgId: session.user.org_id,
      warehouseId: input.warehouseId,
      userId: session.user.id,
      lines: input.lines,
    });
    if (!core.ok) return { ok: false, error: core.error };

    return {
      ok: true,
      synced: core.synced,
      results: core.lineResults.map((r) => ({ productId: r.productId, delta: r.delta, balanceAfter: r.balanceAfter })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ซิงค์ไม่สำเร็จ" };
  }
}

// ════════════════════════════════════════════════════════════════════
// ใบนับ (stock count sheet) — เอกสาร metadata ทับด้านบนการปรับสต๊อก
// ════════════════════════════════════════════════════════════════════

/**
 * สร้าง "หัวใบนับ" (idempotent-friendly ด้วย countCode) แล้วเขียนบรรทัด snapshot.
 * DEGRADE GRACEFULLY: ถ้าตาราง dc.stock_counts ยังไม่ถูก apply (migration ยังไม่ลง)
 * → catch + console.error + คืน null (เหมือน ensureIssueHeader) → การปรับสต๊อกยังทำงานปกติ.
 */
async function writeCountSheet(args: {
  orgId: string;
  warehouseId: string;
  userId: string;
  note: string | null;
  lineResults: CountSyncLineResult[];
}): Promise<{ countId: string; countCode: string } | null> {
  try {
    const countCode = genCode("CNT");
    const created = await prisma.dcStockCount.create({
      data: {
        orgId: args.orgId,
        countCode,
        warehouseId: args.warehouseId,
        note: args.note,
        actorUserId: args.userId,
        lines: {
          create: args.lineResults.map((r) => ({
            orgId: args.orgId,
            productId: r.productId,
            systemQty: r.systemQty,
            countedQty: r.countedQty,
            variance: r.delta,
          })),
        },
      },
      select: { id: true, countCode: true },
    });
    return { countId: created.id, countCode: created.countCode };
  } catch (e) {
    // ★ create พัง (ส่วนใหญ่ = ตารางยังไม่ apply) — เดิมไม่มีตารางนี้ · surface ไว้ diagnose
    //   แต่ degrade เป็น null: การปรับสต๊อก (COUNT_ADJUST) ทำไปแล้วก่อนหน้า จึงไม่กระทบ.
    console.error("[dc:writeCountSheet] create failed", e);
    return null;
  }
}

export type SaveCountSheetLine = { productId: string; countedQty: number; lineKey: string };

export type SaveCountSheetResult =
  | {
      ok: true;
      countId: string | null; // null = ยังไม่สร้างใบได้ (ตารางยังไม่ apply) แต่สต๊อกปรับแล้ว
      countCode: string | null;
      synced: string[];
      results: { productId: string; delta: number; balanceAfter: number }[];
    }
  | { ok: false; error: string };

/**
 * บันทึก "ใบนับ" 1 ใบ:
 *   (a) ปรับสต๊อกจากรายการนับ (applyCountLines) — systemQty/variance คิดสดฝั่ง server
 *   (b) สร้างหัวใบ DcStockCount (countCode) + บรรทัด DcStockCountLine (snapshot ถาวร)
 *   (c) movement COUNT_ADJUST ผูก refType="dc_count" refId=count.id (ที่ delta ≠ 0)
 * ★ ปรับสต๊อกก่อน แล้วค่อยเขียนใบ → ถ้าใบเขียนไม่ได้ (ตารางยังไม่ apply) สต๊อกยังถูกต้อง
 *   (ใบนับเป็น metadata เสริม · idempotency ของสต๊อกไม่เปลี่ยน).
 */
export async function saveCountSheet(input: {
  warehouseId: string;
  note?: string | null;
  lines: SaveCountSheetLine[];
}): Promise<SaveCountSheetResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์นับสต๊อก" };
    }
    await assertWarehouseAllowed(session, input.warehouseId);
    const orgId = session.user.org_id;
    const userId = session.user.id;
    const note = (input.note ?? "").trim() || null;

    // (a) ปรับสต๊อกก่อน (idempotent) — ยังไม่รู้ refId เพราะยังไม่ได้สร้างหัวใบ
    const core = await applyCountLines({ orgId, warehouseId: input.warehouseId, userId, lines: input.lines });
    if (!core.ok) return { ok: false, error: core.error };

    // (b)(c) สร้างหัวใบ + บรรทัด snapshot (degrade graceful ถ้าตารางยังไม่ apply)
    const sheet = core.lineResults.length > 0
      ? await writeCountSheet({ orgId, warehouseId: input.warehouseId, userId, note, lineResults: core.lineResults })
      : null;

    // ผูก refId ให้ movement ที่มี delta ≠ 0 (best-effort · ถ้าตารางใบมี) — ยิงซ้ำ recordMovement
    // ด้วย sourceKey เดิม = duplicate no-op (ไม่ปรับสต๊อกซ้ำ) แต่จะ "อัปเดต" refId ไม่ได้ผ่าน record
    // (record คืน duplicate ทันที). แทนที่จะ record ซ้ำ → อัปเดต refId ตรง ๆ ที่ movement rows.
    if (sheet) {
      try {
        const adjustedKeys = core.lineResults.filter((r) => r.delta !== 0).map((r) => sourceKey("count", r.lineKey));
        if (adjustedKeys.length > 0) {
          await prisma.dcStockMovement.updateMany({
            where: { orgId, sourceKey: { in: adjustedKeys } },
            data: { refType: "dc_count", refId: sheet.countId },
          });
        }
      } catch (e) {
        console.error("[dc:saveCountSheet] link movements failed", e);
      }
    }

    return {
      ok: true,
      countId: sheet?.countId ?? null,
      countCode: sheet?.countCode ?? null,
      synced: core.synced,
      results: core.lineResults.map((r) => ({ productId: r.productId, delta: r.delta, balanceAfter: r.balanceAfter })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกใบนับไม่สำเร็จ" };
  }
}

// ---- ประวัติใบนับ (list + detail) ----

export type CountSheetSummary = {
  countId: string;
  countCode: string;
  countedAt: string;
  actorName: string | null;
  lineCount: number;
  netVariance: number; // ผลรวมส่วนต่าง (ขาดหักเกิน)
};

export type ListCountSheetsResult =
  | { ok: true; sheets: CountSheetSummary[] }
  | { ok: false; error: string };

/** resolve actorUserId → ชื่อผู้ใช้ (batch · scope orgId) — mirror po-actions nameOf. */
async function resolveActorNames(orgId: string, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, orgId },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, (u.name ?? "").trim() || u.email || "—"]));
}

/**
 * รายการใบนับล่าสุด (เฉพาะคลังที่ผู้ใช้เข้าถึงได้ · กรอง warehouseId ได้).
 * DEGRADE: ถ้าตารางยังไม่ apply → คืน list ว่าง (ไม่พังหน้า).
 */
export async function listCountSheets(input?: {
  warehouseId?: string;
  limit?: number;
}): Promise<ListCountSheetsResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์ดูประวัติใบนับ" };
    }
    const orgId = session.user.org_id;

    // จำกัดให้อยู่ในคลังที่ผู้ใช้เข้าถึงได้ (ไม่หลุดข้ามคลังที่ไม่มีสิทธิ์)
    const allowed = await getAllowedWarehouses(session);
    const allowedIds = new Set(allowed.map((w) => w.id));
    const wh = (input?.warehouseId ?? "").trim();
    if (wh && !allowedIds.has(wh)) return { ok: true, sheets: [] };
    const whereWh = wh ? [wh] : [...allowedIds];
    if (whereWh.length === 0) return { ok: true, sheets: [] };

    const rows = await prisma.dcStockCount.findMany({
      where: { orgId, warehouseId: { in: whereWh } },
      orderBy: { countedAt: "desc" },
      take: Math.min(Math.max(input?.limit ?? 50, 1), 200),
      select: {
        id: true,
        countCode: true,
        countedAt: true,
        actorUserId: true,
        lines: { select: { variance: true } },
      },
    });

    const names = await resolveActorNames(orgId, rows.map((r) => r.actorUserId));

    return {
      ok: true,
      sheets: rows.map((r) => ({
        countId: r.id,
        countCode: r.countCode,
        countedAt: r.countedAt.toISOString(),
        actorName: r.actorUserId ? names.get(r.actorUserId) ?? null : null,
        lineCount: r.lines.length,
        netVariance: r.lines.reduce((s, l) => s + l.variance, 0),
      })),
    };
  } catch (e) {
    // ตารางยังไม่ apply ฯลฯ → degrade เป็นว่าง (หน้าไม่ควรพังเพราะยังไม่ได้ migrate)
    console.error("[dc:listCountSheets]", e);
    return { ok: true, sheets: [] };
  }
}

export type CountSheetLineDetail = {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  systemQty: number;
  countedQty: number;
  variance: number;
  imageUrl: string | null; // URL รูปสินค้าเต็ม (null = ไม่มีรูป)
};

export type CountSheetDetail = {
  countId: string;
  countCode: string;
  countedAt: string;
  note: string | null;
  actorName: string | null;
  warehouseName: string | null;
  lines: CountSheetLineDetail[];
  netVariance: number;
};

export type GetCountSheetResult =
  | { ok: true; sheet: CountSheetDetail }
  | { ok: false; error: string };

/** รายละเอียดใบนับ 1 ใบ (หัว + บรรทัด + ชื่อสินค้า/SKU) — scope orgId + คลังที่เข้าถึงได้. */
export async function getCountSheet(countId: string): Promise<GetCountSheetResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์ดูใบนับ" };
    }
    const orgId = session.user.org_id;
    const id = (countId ?? "").trim();
    if (!id) return { ok: false, error: "ไม่พบใบนับ" };

    const head = await prisma.dcStockCount.findFirst({
      where: { id, orgId },
      select: {
        id: true,
        countCode: true,
        countedAt: true,
        note: true,
        actorUserId: true,
        warehouseId: true,
        lines: {
          orderBy: { createdAt: "asc" },
          select: { productId: true, systemQty: true, countedQty: true, variance: true },
        },
      },
    });
    if (!head) return { ok: false, error: "ไม่พบใบนับ" };

    // ต้องเป็นคลังที่ผู้ใช้เข้าถึงได้
    const allowed = await getAllowedWarehouses(session);
    const wh = allowed.find((w) => w.id === head.warehouseId);
    if (!wh) return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงคลังของใบนับนี้" };

    const productIds = [...new Set(head.lines.map((l) => l.productId))];
    const products = productIds.length
      ? await prisma.dcProduct.findMany({
          where: { id: { in: productIds }, orgId },
          select: { id: true, name: true, sku: true, unit: true, imageR2Path: true },
        })
      : [];
    const pById = new Map(products.map((p) => [p.id, p]));

    const names = await resolveActorNames(orgId, [head.actorUserId]);

    // resolve รูปสินค้าเป็น URL เต็ม (R2 key หรือ http เต็ม)
    const r2Public = process.env.R2_PUBLIC_URL ?? "";
    const toImageUrl = (key: string | null | undefined): string | null =>
      !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

    const lines: CountSheetLineDetail[] = head.lines.map((l) => {
      const p = pById.get(l.productId);
      return {
        productId: l.productId,
        name: p?.name ?? "(สินค้าถูกลบ)",
        sku: p?.sku ?? "—",
        unit: p?.unit ?? null,
        systemQty: l.systemQty,
        countedQty: l.countedQty,
        variance: l.variance,
        imageUrl: toImageUrl(p?.imageR2Path),
      };
    });

    return {
      ok: true,
      sheet: {
        countId: head.id,
        countCode: head.countCode,
        countedAt: head.countedAt.toISOString(),
        note: head.note,
        actorName: head.actorUserId ? names.get(head.actorUserId) ?? null : null,
        warehouseName: wh.name,
        lines,
        netVariance: lines.reduce((s, l) => s + l.variance, 0),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดใบนับไม่สำเร็จ" };
  }
}

// ---- log การเคลื่อนไหวรายสินค้า (per-product movement history) ----

export type ProductStockLogEntry = {
  kind: string; // label ไทย
  qty: number; // signed (+ เข้า / − ออก)
  balanceAfter: number | null; // เหลือหลังรายการนี้
  occurredAt: string;
  note: string | null;
  warehouseName: string | null;
};

export type ProductStockLogResult =
  | {
      ok: true;
      product: { id: string; name: string; sku: string; unit: string | null; imageUrl: string | null };
      onHand: number; // รวมทุกคลังที่ผู้ใช้เข้าถึงได้
      entries: ProductStockLogEntry[];
    }
  | { ok: false; error: string };

/**
 * ประวัติการเคลื่อนไหวของสินค้า 1 ตัว (ทุกชนิด movement) เฉพาะคลังที่ผู้ใช้เข้าถึงได้ —
 * ใช้ทำ "log รายสินค้า" (kind · qty± · เหลือ · วันที่). scope orgId เสมอ.
 */
export async function getProductStockLog(
  productId: string,
  opts?: { limit?: number },
): Promise<ProductStockLogResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์ดูประวัติสินค้า" };
    }
    const orgId = session.user.org_id;
    const pid = (productId ?? "").trim();
    if (!pid) return { ok: false, error: "ไม่พบสินค้า" };

    const product = await prisma.dcProduct.findFirst({
      where: { id: pid, orgId },
      select: { id: true, name: true, sku: true, unit: true, imageR2Path: true },
    });
    if (!product) return { ok: false, error: "ไม่พบสินค้า" };

    const allowed = await getAllowedWarehouses(session);
    const allowedIds = allowed.map((w) => w.id);
    const nameById = new Map(allowed.map((w) => [w.id, w.name]));

    // on-hand รวมทุกคลังที่เข้าถึงได้
    const balances = allowedIds.length
      ? await prisma.dcStockBalance.findMany({
          where: { orgId, productId: pid, warehouseId: { in: allowedIds } },
          select: { qtyOnHand: true },
        })
      : [];
    const onHand = balances.reduce((s, b) => s + b.qtyOnHand, 0);

    const moves = allowedIds.length
      ? await prisma.dcStockMovement.findMany({
          where: { orgId, productId: pid, warehouseId: { in: allowedIds } },
          orderBy: { occurredAt: "desc" },
          take: Math.min(Math.max(opts?.limit ?? 40, 1), 200),
          select: { kind: true, qty: true, balanceAfter: true, occurredAt: true, note: true, warehouseId: true },
        })
      : [];

    const r2Public = process.env.R2_PUBLIC_URL ?? "";
    const toImageUrl = (key: string | null): string | null =>
      !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

    return {
      ok: true,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        imageUrl: toImageUrl(product.imageR2Path),
      },
      onHand,
      entries: moves.map((m) => ({
        kind: MOVE_KIND_LABEL[m.kind] ?? m.kind,
        qty: m.qty,
        balanceAfter: m.balanceAfter,
        occurredAt: m.occurredAt.toISOString(),
        note: m.note,
        warehouseName: nameById.get(m.warehouseId) ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดประวัติสินค้าไม่สำเร็จ" };
  }
}
