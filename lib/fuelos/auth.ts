// FuelOS auth bridge — maps Pool's Supabase session → the fuel module's identity.
// Strategy: fuel records key off Pool UUIDs (FuelUser.id == Pool user.id,
// Org.id == Pool org_id) so a Pool user maps 1:1 to a fuel identity with no
// extra link field. FuelUser + Org are auto-provisioned on first access.
//
// This REPLACES pooil-fuel's standalone JWT guard (lib/auth/guard.ts). Ported
// fuel code imports requireUser/requireRole/atLeast/RANK from here.
import { cache } from "react";
import { requireSession, type DbUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export type FuelRole =
  | "OWNER" | "ADMIN" | "SALES_HEAD" | "FINANCE" | "DISPATCH" | "SALES" | "DRIVER";

// fuel rank hierarchy (from pooil-fuel guard.ts) — used by atLeast()
export const RANK: Record<FuelRole, number> = {
  OWNER: 100, ADMIN: 90, SALES_HEAD: 80, FINANCE: 70, DISPATCH: 60, SALES: 50, DRIVER: 20,
};

// Pool's 9 roles → fuel's 7 roles
function mapRole(role: DbUser["role"]): FuelRole {
  switch (role) {
    case "super_admin": return "OWNER";
    case "org_admin": return "ADMIN";
    case "admin": return "SALES_HEAD";
    case "area_manager": return "FINANCE";
    case "branch_manager": return "DISPATCH";
    case "driver": return "DRIVER";
    default: return "SALES"; // staff | viewer | program_admin
  }
}

export type FuelUserCtx = { id: string; orgId: string; role: FuelRole; name: string };

// Resolve (and lazily provision) the fuel identity for the current Pool session.
// React cache() dedupes within a request so the upsert runs at most once per render.
export const getCurrentUser = cache(async (): Promise<FuelUserCtx> => {
  const session = await requireSession(); // redirects to /login if not authed
  const u = session.user;
  const role = mapRole(u.role);

  const email = u.email ?? `${u.id}@pool.local`;

  // 1) เคสปกติ: fuel identity ที่ id == Pool user.id (provisioned โดยสะพานนี้)
  // perf: steady-state = 1 indexed PK read, 0 writes.
  let fuel = await prisma.fuelUser.findUnique({
    where: { id: u.id },
    select: { id: true, role: true, orgId: true },
  });

  // 2) เคส MIGRATION (สำคัญ): pooil-fuel เดิมสร้าง user ไว้แล้วด้วย email เดียวกัน
  //    แต่ id คนละตัว → ถ้า create ซ้ำจะชน `email @unique` (P2002) แล้วพังทั้งหน้า.
  //    → adopt identity เดิม + ใช้ orgId เดิมของมัน (ข้อมูล customers/orders/quotes
  //    ทั้งหมดผูกกับ id + org นี้ ไม่ใช่ org ใหม่ของ Pool) ให้ user เห็นข้อมูลที่ย้ายมา.
  if (!fuel) {
    fuel = await prisma.fuelUser.findFirst({
      where: { email },
      select: { id: true, role: true, orgId: true },
    });
  }

  // 3) user ใหม่จริง ๆ (ไม่มีทั้ง id และ email เดิม) → provision ใหม่ใต้ org ของ Pool
  if (!fuel) {
    await prisma.org.upsert({ where: { id: u.org_id }, create: { id: u.org_id, name: "PO Oil" }, update: {} });
    fuel = await prisma.fuelUser.create({
      data: {
        id: u.id,
        orgId: u.org_id,
        email,
        passwordHash: "", // login ผ่าน Pool/Supabase; password ฝั่ง fuel ไม่ใช้
        name: u.name,
        role,
      },
      select: { id: true, role: true, orgId: true },
    });
  }

  // sync role ให้ตรงกับ Pool (source of truth) เมื่อเปลี่ยนเท่านั้น
  if (fuel.role !== role) {
    await prisma.fuelUser.update({ where: { id: fuel.id }, data: { role, name: u.name } });
  }

  // ใช้ orgId ของ fuel identity (เคส migration = org เดิมที่ข้อมูลอยู่ · เคสใหม่ = org ของ Pool)
  return { id: fuel.id, orgId: fuel.orgId, role, name: u.name };
});

export async function requireUser(): Promise<FuelUserCtx> {
  return getCurrentUser();
}

export function atLeast(role: FuelRole, min: FuelRole): boolean {
  return RANK[role] >= RANK[min];
}

export async function requireRole(...allowed: FuelRole[]): Promise<FuelUserCtx> {
  const ctx = await getCurrentUser();
  if (!allowed.includes(ctx.role)) throw new Error("ไม่มีสิทธิ์เข้าถึงส่วนนี้");
  return ctx;
}
