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

  // fuel Org keyed by Pool org_id (1:1)
  await prisma.org.upsert({
    where: { id: u.org_id },
    create: { id: u.org_id, name: "PO Oil" },
    update: {},
  });
  // FuelUser keyed by Pool user.id (1:1) — keeps fuel role in sync with Pool role
  await prisma.fuelUser.upsert({
    where: { id: u.id },
    create: {
      id: u.id,
      orgId: u.org_id,
      email: u.email ?? `${u.id}@pool.local`,
      passwordHash: "", // login is via Pool/Supabase; fuel password unused
      name: u.name,
      role,
    },
    update: { role, name: u.name },
  });

  return { id: u.id, orgId: u.org_id, role, name: u.name };
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
