"use server";

// DC Warehouse · FLOOR "ใบที่ฉันส่ง / รอรับเข้า" (transfer list) — server actions.
//
// หน้าไล่ดูใบโอนสำหรับพนักงานหน้างานบนมือถือ:
//   • listMyOutgoingTransfers — ใบที่ "ส่งออกจากคลังนี้" (fromWarehouseId = คลังที่ทำงาน)
//   • listIncomingTransfers   — ใบที่ "มีของเข้ามารอรับ" (toWarehouseId = คลังนี้ · IN_TRANSIT · WAREHOUSE dest)
//
// READ-ONLY: ไม่มีการเขียน/ขยับสต๊อก/ต้นทุนในไฟล์นี้เลย — pure SELECT.
// gate ด้วย requireSession + canDcFloor + assertWarehouseAllowed → ผู้ใช้เห็นได้เฉพาะ
// คลังที่ตัวเองผูกสิทธิ์ (bound) เท่านั้น (กันดูใบของไซต์อื่นด้วยการเดา warehouseId).

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";

export type TransferListRow = {
  id: string;
  transferCode: string;
  status: string;
  dispatchedAt: string | null; // ISO — client จัด format เอง
  confirmedAt: string | null; // ISO
  /** ป้ายปลายทาง (ชื่อคลัง/สาขา/โมดูล) — ใช้ในฝั่ง "ส่งออก" */
  destLabel: string;
  /** ชื่อคลังต้นทาง — ใช้ในฝั่ง "รอรับเข้า" */
  fromLabel: string;
  lineCount: number;
  firstImageUrl: string | null;
  /** true ถ้าคนที่กำลังดูเป็นคนกดส่งใบนี้เอง (hint "ฉันส่งเอง") */
  dispatchedByMe: boolean;
  /** ชื่อคนกดส่งใบ (โชว์ในแถวเมื่อไม่ใช่ฉัน) */
  dispatchedByName: string | null;
};

/** ตัวเลือกใน dropdown filter ปลายทาง/ต้นทาง — key: "w:<id>" = คลัง · "b:<label>" = สาขา/โมดูล */
export type TransferPartyOption = { key: string; label: string };

export type ListTransfersResult =
  | { ok: true; rows: TransferListRow[] }
  | { ok: false; error: string };

// resolve R2 key → URL เต็มฝั่ง server (client อ่าน env ไม่ได้) — pattern เดียวกับ
// floor-products-actions.ts / transfer-actions.ts
function makeImageResolver(): (key: string | null | undefined) => string | null {
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  return (key) =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;
}

// ── filter helpers ────────────────────────────────────────────────
// วันที่จาก UI เป็น "YYYY-MM-DD" → ช่วงเวลา [เริ่มวัน, สิ้นวัน] เขตเวลาไทย
// (+07:00 คงที่ ไทยไม่มี DST) — server บน Vercel เป็น UTC ห้ามใช้ local midnight
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dispatchedAtRange(
  dateFrom?: string,
  dateTo?: string,
): { gte?: Date; lt?: Date } | null {
  const parse = (d: string | undefined): Date | undefined => {
    if (!d || !DATE_RE.test(d)) return undefined;
    const dt = new Date(`${d}T00:00:00+07:00`);
    return Number.isNaN(dt.getTime()) ? undefined : dt;
  };
  const gte = parse(dateFrom);
  // ขอบบน = เที่ยงคืนของ "วันถัดไป" แบบ exclusive (lt) — เก็บ timestamp ละเอียดระดับ
  // microsecond ของ Postgres ครบทั้งวัน (ไม่ใช้ 23:59:59.999 ที่มีรูโหว่ 1ms สุดท้าย)
  const toStart = parse(dateTo);
  const lt = toStart ? new Date(toStart.getTime() + 24 * 60 * 60 * 1000) : undefined;
  if (!gte && !lt) return null;
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

// แปลง key จาก dropdown ปลายทาง → where clause (ฝั่งส่งออก)
function destWhere(dest?: string): Record<string, unknown> {
  const v = (dest ?? "").trim();
  if (v.startsWith("w:") && v.length > 2)
    return { destType: DcTransferDestType.WAREHOUSE, toWarehouseId: v.slice(2) };
  if (v.startsWith("b:") && v.length > 2)
    return { destType: { not: DcTransferDestType.WAREHOUSE }, toLabel: v.slice(2) };
  return {};
}

// ชื่อคนส่งของทุกใบในลิสต์ (batch เดียว) — โชว์ "ส่งโดย X" ในแถว
async function loadDispatcherNames(
  orgId: string,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, orgId }, // orgId = defense-in-depth (ids มาจากใบใน org อยู่แล้ว)
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * ใบที่ "ส่งออกจากคลังนี้" (fromWarehouseId = คลังที่กำลังทำงาน) — ทุกสถานะ เรียงส่งล่าสุดก่อน.
 * scope: orgId + warehouse (assertWarehouseAllowed) · take ~100.
 */
export async function listMyOutgoingTransfers(input: {
  warehouseId: string;
  q?: string;
  limit?: number;
  /** filter วันที่ส่ง "YYYY-MM-DD" (ช่วง · เขตเวลาไทย) */
  dateFrom?: string;
  dateTo?: string;
  /** filter ปลายทาง — key จาก listTransferPartyOptions ("w:<id>" | "b:<label>") */
  dest?: string;
}): Promise<ListTransfersResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอน" };
    const warehouseId = (input.warehouseId ?? "").trim();
    if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };
    await assertWarehouseAllowed(session, warehouseId);
    const orgId = session.user.org_id;

    const q = (input.q ?? "").trim();
    const take = Math.min(Math.max(input.limit ?? 100, 1), 200);

    const dateRange = dispatchedAtRange(input.dateFrom, input.dateTo);

    const transfers = await prisma.dcTransfer.findMany({
      where: {
        orgId,
        fromWarehouseId: warehouseId,
        ...(q ? { transferCode: { contains: q, mode: "insensitive" } } : {}),
        ...(dateRange ? { dispatchedAt: dateRange } : {}),
        ...destWhere(input.dest),
      },
      orderBy: { dispatchedAt: "desc" },
      take,
      select: {
        id: true,
        transferCode: true,
        status: true,
        destType: true,
        toWarehouseId: true,
        toLabel: true,
        dispatchedAt: true,
        confirmedAt: true,
        dispatchedByUserId: true,
        _count: { select: { lines: true } },
        lines: {
          take: 1,
          select: { product: { select: { imageR2Path: true } } },
        },
      },
    });

    // ชื่อคลัง (ต้นทาง = คลังนี้ + ปลายทางที่เป็น warehouse)
    const whIds = new Set<string>([warehouseId]);
    for (const t of transfers) if (t.toWarehouseId) whIds.add(t.toWarehouseId);
    const warehouses = await prisma.dcWarehouse.findMany({
      where: { id: { in: [...whIds] }, orgId },
      select: { id: true, name: true },
    });
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));
    const fromName = whName.get(warehouseId) ?? "คลังต้นทาง";
    const dispatcherName = await loadDispatcherNames(orgId, transfers.map((t) => t.dispatchedByUserId));

    const toImageUrl = makeImageResolver();

    const rows: TransferListRow[] = transfers.map((t) => {
      const destLabel =
        t.destType === DcTransferDestType.WAREHOUSE && t.toWarehouseId
          ? whName.get(t.toWarehouseId) ?? "คลังปลายทาง"
          : t.toLabel ?? "สาขา/โมดูล";
      return {
        id: t.id,
        transferCode: t.transferCode,
        status: t.status,
        dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
        confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
        destLabel,
        fromLabel: fromName,
        lineCount: t._count.lines,
        firstImageUrl: toImageUrl(t.lines[0]?.product?.imageR2Path),
        dispatchedByMe: t.dispatchedByUserId === session.user.id,
        dispatchedByName: dispatcherName.get(t.dispatchedByUserId) ?? null,
      };
    });

    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการใบโอนไม่สำเร็จ" };
  }
}

/**
 * ใบที่ "มีของเข้ามารอรับ" ที่คลังนี้ (toWarehouseId = คลังนี้ · WAREHOUSE dest · IN_TRANSIT).
 * feed สำหรับ "รอรับเข้า" — พนักงานหน้างานกดรับได้ (ล็อกตามคลังที่ผูกสิทธิ์).
 * scope: orgId + warehouse (assertWarehouseAllowed) · take ~100.
 */
export async function listIncomingTransfers(input: {
  warehouseId: string;
  limit?: number;
  /** filter วันที่ส่ง "YYYY-MM-DD" (ช่วง · เขตเวลาไทย) */
  dateFrom?: string;
  dateTo?: string;
  /** filter คลังต้นทาง — key "w:<warehouseId>" จาก listTransferPartyOptions */
  src?: string;
}): Promise<ListTransfersResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอน" };
    const warehouseId = (input.warehouseId ?? "").trim();
    if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };
    await assertWarehouseAllowed(session, warehouseId);
    const orgId = session.user.org_id;

    const take = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const dateRange = dispatchedAtRange(input.dateFrom, input.dateTo);
    const src = (input.src ?? "").trim();
    const srcWarehouseId = src.startsWith("w:") && src.length > 2 ? src.slice(2) : null;

    const transfers = await prisma.dcTransfer.findMany({
      where: {
        orgId,
        toWarehouseId: warehouseId,
        destType: DcTransferDestType.WAREHOUSE,
        status: DcTransferStatus.IN_TRANSIT,
        ...(dateRange ? { dispatchedAt: dateRange } : {}),
        ...(srcWarehouseId ? { fromWarehouseId: srcWarehouseId } : {}),
      },
      orderBy: { dispatchedAt: "desc" },
      take,
      select: {
        id: true,
        transferCode: true,
        status: true,
        fromWarehouseId: true,
        dispatchedAt: true,
        confirmedAt: true,
        dispatchedByUserId: true,
        _count: { select: { lines: true } },
        lines: {
          take: 1,
          select: { product: { select: { imageR2Path: true } } },
        },
      },
    });

    // ชื่อคลัง (ปลายทาง = คลังนี้ + ต้นทางแต่ละใบ)
    const whIds = new Set<string>([warehouseId]);
    for (const t of transfers) whIds.add(t.fromWarehouseId);
    const warehouses = await prisma.dcWarehouse.findMany({
      where: { id: { in: [...whIds] }, orgId },
      select: { id: true, name: true },
    });
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));
    const destName = whName.get(warehouseId) ?? "คลังปลายทาง";
    const dispatcherName = await loadDispatcherNames(orgId, transfers.map((t) => t.dispatchedByUserId));

    const toImageUrl = makeImageResolver();

    const rows: TransferListRow[] = transfers.map((t) => ({
      id: t.id,
      transferCode: t.transferCode,
      status: t.status,
      dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
      confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
      destLabel: destName,
      fromLabel: whName.get(t.fromWarehouseId) ?? "คลังต้นทาง",
      lineCount: t._count.lines,
      firstImageUrl: toImageUrl(t.lines[0]?.product?.imageR2Path),
      dispatchedByMe: t.dispatchedByUserId === session.user.id,
      dispatchedByName: dispatcherName.get(t.dispatchedByUserId) ?? null,
    }));

    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการรอรับไม่สำเร็จ" };
  }
}

// ════════════════════════════════════════════════════════════════════
// ตัวเลือก dropdown filter — ปลายทางที่เคยส่งไป + ต้นทางที่กำลังส่งเข้ามา
// ════════════════════════════════════════════════════════════════════

export type ListTransferPartyOptionsResult =
  | {
      ok: true;
      outgoing: TransferPartyOption[];
      incoming: TransferPartyOption[];
      /** จำนวนใบรอรับเข้าทั้งหมด (ไม่โดน filter วันที่/ต้นทาง) — ใช้กับ badge/banner */
      incomingTotal: number;
    }
  | { ok: false; error: string };

/**
 * รายชื่อสำหรับ dropdown filter ของหน้า /dc/transfers:
 *   • outgoing — ปลายทางทั้งหมดที่คลังนี้ "เคยส่งไป" (คลัง + สาขา/โมดูล)
 *   • incoming — คลังต้นทางของใบ IN_TRANSIT ที่กำลังเข้ามาคลังนี้ (+ นับรวมเป็น incomingTotal)
 * ดึงจากใบโอนจริง (groupBy) → ตัวเลือกไม่จำกัดแค่ 100 ใบล่าสุดที่โชว์ในลิสต์.
 * gate เดียวกับ list: session + canDcFloor + assertWarehouseAllowed. READ-ONLY.
 */
export async function listTransferPartyOptions(input: {
  warehouseId: string;
}): Promise<ListTransferPartyOptionsResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอน" };
    const warehouseId = (input.warehouseId ?? "").trim();
    if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };
    await assertWarehouseAllowed(session, warehouseId);
    const orgId = session.user.org_id;

    const [destGroups, srcGroups] = await Promise.all([
      prisma.dcTransfer.groupBy({
        by: ["destType", "toWarehouseId", "toLabel"],
        where: { orgId, fromWarehouseId: warehouseId },
      }),
      prisma.dcTransfer.groupBy({
        by: ["fromWarehouseId"],
        where: {
          orgId,
          toWarehouseId: warehouseId,
          destType: DcTransferDestType.WAREHOUSE,
          status: DcTransferStatus.IN_TRANSIT,
        },
        _count: { _all: true }, // นับต่อกลุ่ม → Σ = จำนวนรอรับทั้งหมด (ฟรี ไม่ต้อง query เพิ่ม)
      }),
    ]);

    // ชื่อคลังทุกตัวที่โผล่ในทั้งสองกลุ่ม (query เดียว)
    const whIds = new Set<string>();
    for (const g of destGroups) if (g.toWarehouseId) whIds.add(g.toWarehouseId);
    for (const g of srcGroups) whIds.add(g.fromWarehouseId);
    const warehouses = whIds.size
      ? await prisma.dcWarehouse.findMany({
          where: { id: { in: [...whIds] }, orgId },
          select: { id: true, name: true },
        })
      : [];
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));

    const outgoing: TransferPartyOption[] = [];
    const seen = new Set<string>();
    for (const g of destGroups) {
      const opt =
        g.destType === DcTransferDestType.WAREHOUSE && g.toWarehouseId
          ? { key: `w:${g.toWarehouseId}`, label: whName.get(g.toWarehouseId) ?? "คลังปลายทาง" }
          : g.toLabel
            ? { key: `b:${g.toLabel}`, label: g.toLabel }
            : null;
      if (opt && !seen.has(opt.key)) {
        seen.add(opt.key);
        outgoing.push(opt);
      }
    }
    outgoing.sort((a, b) => a.label.localeCompare(b.label, "th"));

    const incoming: TransferPartyOption[] = srcGroups
      .map((g) => ({
        key: `w:${g.fromWarehouseId}`,
        label: whName.get(g.fromWarehouseId) ?? "คลังต้นทาง",
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "th"));
    const incomingTotal = srcGroups.reduce((sum, g) => sum + g._count._all, 0);

    return { ok: true, outgoing, incoming, incomingTotal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดตัวเลือกไม่สำเร็จ" };
  }
}
