// DC Warehouse · per-warehouse access + active-warehouse context (server-only).
//
// Visibility model (mirrors playland staff-branch):
//   • admin tier (super/org/admin/program_admin) → ALL active warehouses
//   • non-admin WITH DcWarehouseUser bindings → only the bound warehouses
//   • non-admin WITHOUT bindings → ONLY the default warehouse (ถ้ามี) — กันพนักงาน
//     ที่ยังไม่ผูกสิทธิ์คลัง เห็น/เบิก/โอน/นับ ข้ามคลังได้ทุกคลัง. ถ้าไม่มีคลัง default
//     เลย → เห็นว่าง (ต้องให้แอดมินผูกคลังก่อนถึงทำงานได้)
//
// Back-office manage capability is role-based (canDcManage in role-guard.ts);
// DcWarehouseUser scopes WHICH warehouses a floor user sees/acts on.

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdminTier } from "@/lib/auth/role-guards";
import { requireSession, type Session } from "@/lib/auth/session";

export const DC_WAREHOUSE_COOKIE = "dc_wh";

export type DcWarehouseLite = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  isDefault: boolean;
};

export type DcContext = {
  session: Session;
  isAdmin: boolean;
  warehouses: DcWarehouseLite[];
  activeWarehouseId: string | null;
  activeWarehouse: DcWarehouseLite | null;
};

/** Warehouses this user is allowed to see (scoped by DcWarehouseUser). */
export async function getAllowedWarehouses(session: Session): Promise<DcWarehouseLite[]> {
  const orgId = session.user.org_id;
  const all = await prisma.dcWarehouse.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, location: true, isDefault: true },
  });
  if (isAdminTier(session.user.role)) return all;

  const bindings = await prisma.dcWarehouseUser.findMany({
    where: { orgId, userId: session.user.id, isActive: true },
    select: { warehouseId: true },
  });
  if (bindings.length === 0) {
    // ยังไม่ผูกสิทธิ์คลัง → เห็นเฉพาะคลัง default เท่านั้น (ไม่ใช่ทุกคลัง)
    // กันพนักงานเข้าถึง/เบิก/โอน/นับ ข้ามคลังที่ไม่ได้รับมอบหมาย
    const def = all.find((w) => w.isDefault);
    return def ? [def] : [];
  }
  const allowed = new Set(bindings.map((b) => b.warehouseId));
  return all.filter((w) => allowed.has(w.id));
}

/** Full DC context: session + allowed warehouses + the active one (from cookie). */
export async function getDcContext(session?: Session): Promise<DcContext> {
  const s = session ?? (await requireSession());
  const warehouses = await getAllowedWarehouses(s);
  const jar = await cookies();
  const cookieId = jar.get(DC_WAREHOUSE_COOKIE)?.value ?? null;

  let active: DcWarehouseLite | null = null;
  if (cookieId) active = warehouses.find((w) => w.id === cookieId) ?? null;
  if (!active) active = warehouses.find((w) => w.isDefault) ?? warehouses[0] ?? null;

  return {
    session: s,
    isAdmin: isAdminTier(s.user.role),
    warehouses,
    activeWarehouseId: active?.id ?? null,
    activeWarehouse: active,
  };
}

/** True if user may MANAGE (back-office) the given warehouse. */
export async function isWarehouseManager(session: Session, warehouseId: string): Promise<boolean> {
  if (isAdminTier(session.user.role)) return true;
  const row = await prisma.dcWarehouseUser.findFirst({
    where: { orgId: session.user.org_id, userId: session.user.id, warehouseId, role: "MANAGER", isActive: true },
    select: { id: true },
  });
  return !!row;
}

/** Guard: ensure the user may act on this warehouse (it's in their allowed set). */
export async function assertWarehouseAllowed(session: Session, warehouseId: string): Promise<void> {
  const list = await getAllowedWarehouses(session);
  if (!list.some((w) => w.id === warehouseId)) {
    throw new Error("ไม่มีสิทธิ์เข้าถึงคลังนี้");
  }
}
